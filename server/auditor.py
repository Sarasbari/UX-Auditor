import os
import asyncio
import base64
import json
from typing import List, Dict, Any, Optional
from browser_use.actor.page import Page
from browser_use import Agent, Browser, BrowserProfile, ChatOpenAI
from server.heuristics import HeuristicsAuditor

# Find axe-core path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AXE_PATH = os.path.join(BASE_DIR, "node_modules", "axe-core", "axe.min.js")

async def run_axe_on_page(page: Page) -> Dict[str, Any]:
    """
    Reads axe-core minified JS, injects it into the page, and runs accessibility checks.
    """
    if not os.path.exists(AXE_PATH):
        raise FileNotFoundError(f"axe-core not found at {AXE_PATH}. Make sure node_modules is installed.")
        
    with open(AXE_PATH, "r", encoding="utf-8") as f:
        axe_js = f.read()
    
    # Inject axe-core by wrapping it in an arrow function
    await page.evaluate(f"() => {{ {axe_js} }}")
    
    # Run analysis (CDP evaluation returns JSON string representation or object)
    results = await page.evaluate("() => axe.run()")
    if results:
        if isinstance(results, str):
            try:
                return json.loads(results)
            except Exception:
                pass
        elif isinstance(results, dict):
            return results
    return {}

async def run_deterministic_fallback(url: str, progress_callback = None) -> Dict[str, Any]:
    """
    Fallback audit that uses playwright directly to inspect the page without LLM/agent.
    """
    if progress_callback:
        await progress_callback("Running deterministic fallback audit (no OpenAI API key or agent error)...")
        
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            page = await browser.new_page()
            # Set a 30s timeout for navigation
            if progress_callback:
                await progress_callback(f"Navigating to {url}...")
            await page.goto(url, timeout=30000, wait_until="load")
            
            if progress_callback:
                await progress_callback("Running axe-core & custom heuristics...")
            
            # Capture screenshot
            screenshot_bytes = await page.screenshot(type="png")
            
            # Capture DOM HTML
            html = await page.content()
            
            # Run axe-core
            axe_results = {}
            if os.path.exists(AXE_PATH):
                with open(AXE_PATH, "r", encoding="utf-8") as f:
                    axe_js = f.read()
                await page.evaluate(f"() => {{ {axe_js} }}")
                axe_res = await page.evaluate("() => axe.run()")
                if axe_res:
                    if isinstance(axe_res, str):
                        try:
                            axe_results = json.loads(axe_res)
                        except:
                            pass
                    elif isinstance(axe_res, dict):
                        axe_results = axe_res
            
            # Heuristics
            heuristic_results = {}
            try:
                heuristic_results = await HeuristicsAuditor.run_checks(page, url)
            except Exception as heur_err:
                print(f"Heuristics failed: {heur_err}")
                
            findings = [{
                "step_index": 0,
                "url": url,
                "axe_results": axe_results,
                "heuristic_results": heuristic_results
            }]
            
            if progress_callback:
                await progress_callback("Deterministic audit completed successfully.")
                
            return {
                "url": url,
                "urls_visited": [url],
                "findings": findings,
                "screenshots": [screenshot_bytes],
                "dom_snapshots": [html]
            }
        finally:
            await browser.close()

async def run_audit(url: str, journey_steps: Optional[str] = None, progress_callback = None) -> Dict[str, Any]:
    """
    Launches a headless browser session using browser-use, navigates the target website,
    and runs axe-core & custom heuristics checks at each step.
    """
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key or openai_key.startswith("sk-..."):
        if progress_callback:
            await progress_callback("OPENAI_API_KEY not configured or empty. Using deterministic fallback.")
        return await run_deterministic_fallback(url, progress_callback)

    llm = ChatOpenAI(model="gpt-4o", api_key=openai_key, temperature=0.0, max_retries=1)
    
    # Configure Browser
    browser = Browser(
        browser_profile=BrowserProfile(
            headless=True,
            disable_security=True,  # allows running cross-domain requests
        )
    )
    
    findings = []
    screenshots = []
    dom_snapshots = []
    urls_visited = []

    # Keep track of what we are doing for the progress callback
    step_counter = 0

    async def step_hook(agent: Agent):
        nonlocal step_counter
        step_counter += 1
        try:
            curr_session = agent.browser_session
            page = await curr_session.get_current_page()
            if not page:
                return
                
            current_url = await page.get_url()
            if current_url == "about:blank" or not current_url:
                return
                
            if progress_callback:
                await progress_callback(f"Step {step_counter}: Analyzing page: {current_url}")
            
            urls_visited.append(current_url)
            
            # Wrap inner step operations in a strict 20-second timeout
            async def run_evaluations():
                # Capture screenshot (returns base64 string in custom Page class)
                screenshot_b64 = await page.screenshot()
                screenshot_bytes = base64.b64decode(screenshot_b64)
                
                # Capture DOM HTML
                html = await page.evaluate("() => document.documentElement.outerHTML")
                
                # Run axe-core
                axe_results = {}
                try:
                    axe_results = await run_axe_on_page(page)
                except Exception as axe_err:
                    print(f"Error running axe-core on {current_url}: {axe_err}")
                    
                # Run heuristics
                heuristic_results = {}
                try:
                    heuristic_results = await HeuristicsAuditor.run_checks(page, current_url)
                except Exception as heur_err:
                    print(f"Error running heuristics on {current_url}: {heur_err}")
                    
                return screenshot_bytes, html, axe_results, heuristic_results

            try:
                screenshot_bytes, html, axe_results, heuristic_results = await asyncio.wait_for(
                    run_evaluations(), timeout=20.0
                )
            except asyncio.TimeoutError:
                if progress_callback:
                    await progress_callback(f"Warning: Step {step_counter} timed out during page analysis. Skipping.")
                return
                
            step_index = len(screenshots)
            screenshots.append(screenshot_bytes)
            dom_snapshots.append(html)
            
            findings.append({
                "step_index": step_index,
                "url": current_url,
                "axe_results": axe_results,
                "heuristic_results": heuristic_results
            })
            
        except Exception as step_err:
            print(f"Error in auditor step hook: {step_err}")

    # Formulate Task
    if journey_steps:
        task = f"Go to {url} and perform the following journey steps: {journey_steps}. Make sure to wait for pages to load. Once complete, stop."
    else:
        task = f"Go to {url}, wait for the page to load fully, look around for any interactive elements or main sections, and then stop."

    if progress_callback:
        await progress_callback("Launching browser agent...")

    agent = Agent(
        task=task,
        llm=llm,
        browser=browser
    )
    
    try:
        # Wrap agent.run in a strict 120-second timeout to handle OpenAI API hangs or quota retry loops
        await asyncio.wait_for(agent.run(on_step_end=step_hook), timeout=120.0)
    except Exception as run_err:
        print(f"Browser-use agent run encountered error: {run_err}")
        # If the agent failed but we have captured some findings, we still proceed.
        # Otherwise, fall back to a simple deterministic single-page audit.
        if not findings:
            if progress_callback:
                await progress_callback(f"Agent failed: {run_err}. Falling back to deterministic audit...")
            return await run_deterministic_fallback(url, progress_callback)
    finally:
        try:
            await browser.close()
        except Exception as close_err:
            print(f"Error closing browser: {close_err}")
        
    if progress_callback:
        await progress_callback(f"Journey finished. Captured {len(findings)} page state(s).")
        
    return {
        "url": url,
        "urls_visited": list(set(urls_visited)),
        "findings": findings,
        "screenshots": screenshots,
        "dom_snapshots": dom_snapshots
    }
