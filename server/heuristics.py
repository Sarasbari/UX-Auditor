import asyncio
import aiohttp
from browser_use.actor.page import Page
from typing import List, Dict, Any
import time
import json

class HeuristicsAuditor:
    @staticmethod
    async def run_checks(page: Page, url: str) -> Dict[str, Any]:
        """
        Runs custom Nielsen-style usability and accessibility checks against the active page DOM.
        """
        # 1. Measure load time
        load_time_ms = 0
        try:
            perf_timing = await page.evaluate("""() => {
                const t = window.performance.timing;
                if (!t) return null;
                return {
                    navigationStart: t.navigationStart,
                    loadEventEnd: t.loadEventEnd,
                    responseEnd: t.responseEnd
                };
            }""")
            if perf_timing:
                timing = json.loads(perf_timing) if isinstance(perf_timing, str) else perf_timing
                if timing:
                    if timing.get("navigationStart") and timing.get("loadEventEnd"):
                        load_time_ms = timing["loadEventEnd"] - timing["navigationStart"]
                    elif timing.get("navigationStart") and timing.get("responseEnd"):
                        load_time_ms = timing["responseEnd"] - timing["navigationStart"]
        except Exception as e:
            print(f"Error reading performance timing: {e}")

        # 2. Run contrast check inside JS
        contrast_violations = []
        try:
            res = await page.evaluate("""() => {
                const elements = Array.from(document.querySelectorAll('*'));
                const violations = [];
                elements.forEach(el => {
                    const text = Array.from(el.childNodes)
                        .filter(node => node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length > 0)
                        .map(node => node.nodeValue.trim())
                        .join(' ');
                    if (!text || text.length < 2) return;
                    
                    const style = window.getComputedStyle(el);
                    const color = style.color;
                    let bgColor = style.backgroundColor;
                    
                    let parent = el;
                    while (bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
                        parent = parent.parentElement;
                        if (!parent) {
                            bgColor = 'rgb(255, 255, 255)';
                            break;
                        }
                        bgColor = window.getComputedStyle(parent).backgroundColor;
                    }
                    
                    const parseRGB = (str) => {
                        const match = str.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
                        if (match) return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
                        return [0, 0, 0];
                    };
                    
                    const [r1, g1, b1] = parseRGB(color);
                    const [r2, g2, b2] = parseRGB(bgColor);
                    
                    const getLuminance = (r, g, b) => {
                        const a = [r, g, b].map(v => {
                            v /= 255;
                            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
                        });
                        return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
                    };
                    
                    const l1 = getLuminance(r1, g1, b1);
                    const l2 = getLuminance(r2, g2, b2);
                    
                    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
                    
                    const fontSize = parseFloat(style.fontSize);
                    const fontWeight = style.fontWeight;
                    const isLargeText = fontSize >= 18 || (fontSize >= 14 && (fontWeight === 'bold' || parseInt(fontWeight) >= 700));
                    const threshold = isLargeText ? 3.0 : 4.5;
                    
                    if (ratio < threshold) {
                        const selector = el.tagName.toLowerCase() + 
                            (el.id ? '#' + el.id : '') + 
                            (el.className ? '.' + el.className.split(' ').filter(c => c && !c.includes(':')).slice(0, 3).join('.') : '');
                        violations.push({
                            selector: selector,
                            text: text.substring(0, 100),
                            ratio: ratio.toFixed(2),
                            color: color,
                            bgColor: bgColor
                        });
                    }
                });
                return violations.slice(0, 15); // limit to top 15 contrast issues to keep payload sane
            }""")
            if res:
                contrast_violations = json.loads(res) if isinstance(res, str) else res
        except Exception as e:
            print(f"Error running contrast check: {e}")

        # 3. Run tap-target size check inside JS
        tap_target_violations = []
        try:
            res = await page.evaluate("""() => {
                const interactive = Array.from(document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"]'));
                const violations = [];
                interactive.forEach(el => {
                    const rect = el.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0) return;
                    
                    const style = window.getComputedStyle(el);
                    if (style.display === 'inline' && el.tagName === 'A') {
                        const parent = el.parentElement;
                        if (parent && parent.innerText.trim().length > el.innerText.trim().length * 2) {
                            return; // skip inline text links
                        }
                    }
                    
                    if (rect.width < 44 || rect.height < 44) {
                        const selector = el.tagName.toLowerCase() + 
                            (el.id ? '#' + el.id : '') + 
                            (el.className ? '.' + el.className.split(' ').filter(c => c && !c.includes(':')).slice(0, 3).join('.') : '');
                        violations.push({
                            selector: selector,
                            width: Math.round(rect.width),
                            height: Math.round(rect.height),
                            text: el.innerText.trim().substring(0, 50)
                        });
                    }
                });
                return violations.slice(0, 15); // limit to top 15
            }""")
            if res:
                tap_target_violations = json.loads(res) if isinstance(res, str) else res
        except Exception as e:
            print(f"Error running tap target check: {e}")

        # 4. Form label check inside JS
        form_label_violations = []
        try:
            res = await page.evaluate("""() => {
                const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
                const violations = [];
                inputs.forEach(input => {
                    const type = input.type ? input.type.toLowerCase() : '';
                    if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) return;
                    
                    if (input.getAttribute('aria-label') || input.getAttribute('aria-labelledby')) return;
                    
                    let hasLabel = false;
                    if (input.id) {
                        const label = document.querySelector(`label[for="${input.id}"]`);
                        if (label && label.innerText.trim()) hasLabel = true;
                    }
                    
                    let parent = input.parentElement;
                    while (parent) {
                        if (parent.tagName === 'LABEL' && parent.innerText.trim()) {
                            hasLabel = true;
                            break;
                        }
                        parent = parent.parentElement;
                    }
                    
                    if (!hasLabel) {
                        const selector = input.tagName.toLowerCase() + 
                            (input.id ? '#' + input.id : '') + 
                            (input.className ? '.' + input.className.split(' ').filter(c => c && !c.includes(':')).slice(0, 3).join('.') : '');
                        violations.push({
                            selector: selector,
                            placeholder: input.getAttribute('placeholder') || ''
                        });
                    }
                });
                return violations;
            }""")
            if res:
                form_label_violations = json.loads(res) if isinstance(res, str) else res
        except Exception as e:
            print(f"Error running form label check: {e}")

        # 5. Key actions click depth check
        key_actions = []
        try:
            res = await page.evaluate("""() => {
                const ctaRegex = /(sign\\s*up|register|create\\s*account|join|log\\s*in|sign\\s*in|login|checkout|buy|purchase|pricing|get\\s*started)/i;
                const elements = Array.from(document.querySelectorAll('a, button, [role="button"]'));
                const found = [];
                elements.forEach(el => {
                    const text = el.innerText.trim();
                    if (ctaRegex.test(text)) {
                        const rect = el.getBoundingClientRect();
                        const style = window.getComputedStyle(el);
                        const isVisible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
                        
                        let depth = 0; // Directly on page
                        let parent = el.parentElement;
                        while (parent) {
                            // If inside a dropdown, hidden menu, etc.
                            const parentStyle = window.getComputedStyle(parent);
                            if (parent.tagName === 'NAV' && (parent.className.includes('mobile') || parent.className.includes('hidden'))) {
                                depth = 1;
                            }
                            parent = parent.parentElement;
                        }
                        
                        const selector = el.tagName.toLowerCase() + 
                            (el.id ? '#' + el.id : '') + 
                            (el.className ? '.' + el.className.split(' ').filter(c => c && !c.includes(':')).slice(0, 3).join('.') : '');
                        
                        found.push({
                            text: text,
                            selector: selector,
                            visible: isVisible,
                            clickDepth: depth
                        });
                    }
                });
                return found.slice(0, 10);
            }""")
            if res:
                key_actions = json.loads(res) if isinstance(res, str) else res
        except Exception as e:
            print(f"Error checking key actions: {e}")

        # 6. Broken links check
        broken_links = []
        try:
            res = await page.evaluate("""() => {
                const links = Array.from(document.querySelectorAll('a'))
                    .map(a => a.href)
                    .filter(href => href && (href.startsWith('http://') || href.startsWith('https://')));
                return Array.from(new Set(links));
            }""")
            if res:
                urls_to_check = json.loads(res) if isinstance(res, str) else res
            else:
                urls_to_check = []
            
            # Check up to 8 links asynchronously in parallel to save time
            urls_to_check = urls_to_check[:8]
            try:
                broken_links = await asyncio.wait_for(
                    HeuristicsAuditor._check_urls_status(urls_to_check),
                    timeout=5.0
                )
            except asyncio.TimeoutError:
                print("Warning: Broken link check timed out. Skipping.")
                broken_links = []
        except Exception as e:
            print(f"Error checking broken links: {e}")

        return {
            "load_time_ms": load_time_ms,
            "contrast_violations": contrast_violations,
            "tap_target_violations": tap_target_violations,
            "form_label_violations": form_label_violations,
            "key_actions": key_actions,
            "broken_links": broken_links
        }

    @staticmethod
    async def _check_urls_status(urls: List[str]) -> List[Dict[str, Any]]:
        broken = []
        async with aiohttp.ClientSession() as session:
            tasks = [HeuristicsAuditor._check_url(session, url) for url in urls]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for url, result in zip(urls, results):
                if isinstance(result, Exception):
                    broken.append({
                        "url": url,
                        "error": str(result)
                    })
                elif result is not None and result >= 400:
                    broken.append({
                        "url": url,
                        "status": result
                    })
        return broken

    @staticmethod
    async def _check_url(session: aiohttp.ClientSession, url: str):
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        try:
            # Set a low timeout to not block the audit run
            async with session.head(url, timeout=2.5, headers=headers, allow_redirects=True) as response:
                if response.status >= 400:
                    # Fallback to GET just in case HEAD is not allowed
                    async with session.get(url, timeout=2.5, headers=headers, allow_redirects=True) as get_resp:
                        return get_resp.status
                return response.status
        except Exception as e:
            # try GET directly in case HEAD fails
            try:
                async with session.get(url, timeout=2.5, headers=headers, allow_redirects=True) as get_resp:
                    return get_resp.status
            except Exception as inner_e:
                return inner_e
