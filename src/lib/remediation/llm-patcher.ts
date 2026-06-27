import OpenAI from "openai";

export interface LlmPatchResult {
  success: boolean;
  filePath: string;
  originalSnippet: string;
  patchedSnippet: string;
  explanation: string;
  patchedContent?: string;
  error?: string;
}

/**
 * Uses LLM to generate an exact-match code patch for a candidate file.
 * Validates character-for-character presence of originalSnippet.
 */
export async function generateCodePatch(
  filePath: string,
  fileContent: string,
  issue: {
    ruleId: string | null;
    elementSelector: string | null;
    description: string;
    fixSuggestion: string | null;
    fixDiff?: any;
  },
  framework: string,
  usesTailwind: boolean
): Promise<LlmPatchResult> {
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!openaiKey || openaiKey.startsWith("sk-...")) {
    return {
      success: false,
      filePath,
      originalSnippet: "",
      patchedSnippet: "",
      explanation: "",
      error: "OpenAI API Key is missing or invalid",
    };
  }

  const openai = new OpenAI({ apiKey: openaiKey });

  const prompt = `You are a web developer and accessibility (WCAG) expert. You need to fix a UX/accessibility issue in a project.
Detected Framework: ${framework}
Uses Tailwind CSS: ${usesTailwind ? "Yes" : "No"}

File: ${filePath}
Issue Rule ID: ${issue.ruleId || "N/A"}
Element Selector: ${issue.elementSelector || "N/A"}
Description: ${issue.description}
Suggested Fix: ${issue.fixSuggestion || "N/A"}

Below is the complete content of the file:
\`\`\`
${fileContent}
\`\`\`

Propose a highly targeted, safe code patch.
Your patch must be returned as a JSON object of type:
{
  "filePath": "${filePath}",
  "originalSnippet": "Exact code block to replace",
  "patchedSnippet": "Replacement code block",
  "explanation": "Brief explanation of the changes made"
}

CRITICAL RULES:
1. "originalSnippet" MUST match a unique part of the file content character-for-character, including exact indentation, spacing, newlines, and quotes. If the snippet is not identical, the patch will fail.
2. Make the patch as minimal as possible. Replace only the target element or attribute.
3. If this is a Tailwind project, use Tailwind classes (e.g., adding "min-h-11 min-w-11" or padding classes to classNames) to resolve touch-target sizes.
4. For meta-viewport rules, modify/remove user-scalable=no, maximum-scale=1, or add viewport export configuration for Next.js App Router layouts.
5. If the layout or fix is too complex or unsafe, return empty string for "originalSnippet" to decline patching.
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a professional assistant that generates precise code remediation patches in JSON format. Always return valid JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1, // low temperature for high precision/consistency
    });

    const choiceContent = response.choices[0]?.message?.content;
    if (!choiceContent) {
      throw new Error("Empty response from OpenAI");
    }

    const patch = JSON.parse(choiceContent);

    const original = patch.originalSnippet || "";
    const patched = patch.patchedSnippet || "";
    const explanation = patch.explanation || "";

    if (!original) {
      return {
        success: false,
        filePath,
        originalSnippet: "",
        patchedSnippet: "",
        explanation: "LLM declined to patch this issue (too complex or unsafe)",
        error: "Patch declined",
      };
    }

    // Check if the original snippet exists in the file content
    const occurrences = fileContent.split(original).length - 1;

    if (occurrences === 0) {
      return {
        success: false,
        filePath,
        originalSnippet: original,
        patchedSnippet: patched,
        explanation,
        error: "Original snippet not found in target file. Double check spacing, newlines, and indentation.",
      };
    }

    if (occurrences > 1) {
      return {
        success: false,
        filePath,
        originalSnippet: original,
        patchedSnippet: patched,
        explanation,
        error: "Original snippet is ambiguous: it matches multiple locations in the file.",
      };
    }

    // Apply the patch
    const patchedContent = fileContent.replace(original, patched);

    return {
      success: true,
      filePath,
      originalSnippet: original,
      patchedSnippet: patched,
      explanation,
      patchedContent,
    };
  } catch (error) {
    console.error("LLM patching failed:", error);
    return {
      success: false,
      filePath,
      originalSnippet: "",
      patchedSnippet: "",
      explanation: "",
      error: error instanceof Error ? error.message : "Failed to generate patch from LLM",
    };
  }
}
