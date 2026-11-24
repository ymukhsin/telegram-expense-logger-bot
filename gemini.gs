/**
 * Pocket Ledger Bot — Gemini AI Extraction Module (v1.1 WIP)
 * Uses Gemini Flash Structured Outputs to parse natural-language expenses
 * and receipt images into strict JSON matching ledger categories.
 */

const GEMINI_MODEL = "gemini-3.5-flash-lite";

const EXPENSE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    isExpense: {
      type: "BOOLEAN",
      description: "True if the text or image represents a real purchase, bill, or expense."
    },
    amount: {
      type: "NUMBER",
      description: "Total numeric amount paid. Return 0 if no clear amount is present."
    },
    category: {
      type: "STRING",
      enum: ["Food", "Transport", "Bills", "Shopping", "Other"],
      description: "Best fitting category for the expense."
    },
    description: {
      type: "STRING",
      description: "Short merchant or item summary (2 to 5 words)."
    }
  },
  required: ["isExpense", "amount", "category", "description"]
};

/**
 * Sends text and/or an image blob to Gemini and returns a structured expense object.
 * Returns null if the API key is missing, the request fails, or input is not an expense.
 */
function extractExpenseWithGemini(textInput, imageBlob, apiKey) {
  if (!apiKey) return null;

  const parts = [
    {
      text:
        "Extract expense details from the user input or receipt image. " +
        "Normalize currency numbers (e.g. '18.5k' or '18,500 won' -> 18500). " +
        "If it is casual chat and not an expense, set isExpense to false."
    }
  ];

  if (textInput) {
    parts.push({ text: "User note: " + textInput });
  }

  if (imageBlob) {
    parts.push({
      inlineData: {
        mimeType: imageBlob.getContentType() || "image/jpeg",
        data: Utilities.base64Encode(imageBlob.getBytes())
      }
    });
  }

  const payload = {
    contents: [{ role: "user", parts: parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: EXPENSE_RESPONSE_SCHEMA,
      temperature: 0.1
    }
  };

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const response = UrlFetchApp.fetch(endpoint, {
      method: "post",
      contentType: "application/json",
      headers: { "x-goog-api-key": apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      console.error("Gemini API error:", response.getContentText());
      return null;
    }

    const body = JSON.parse(response.getContentText());
    const rawJson = body?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawJson) return null;

    const parsed = JSON.parse(rawJson);
    if (!parsed.isExpense || !parsed.amount || parsed.amount <= 0) {
      return null;
    }

    return {
      amount: Number(parsed.amount),
      category: parsed.category || "Other",
      description: String(parsed.description || "AI-logged expense").trim()
    };
  } catch (err) {
    console.error("Gemini parsing failed:", err);
    return null;
  }
}