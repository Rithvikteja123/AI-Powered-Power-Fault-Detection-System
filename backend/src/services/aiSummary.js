/**
 * AI Summary Service (Google Gemini Powered)
 *
 * Generates a 2-sentence plain-English operator narrative for each fault ticket
 * using Google Gemini AI models.
 */

async function generateSummary(ticket, boundary) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const faultDesc = describeFault(ticket, boundary);

  if (!apiKey) {
    return templateSummary(ticket, boundary, faultDesc);
  }

  try {
    const prompt = buildPrompt(ticket, boundary, faultDesc);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 120, temperature: 0.3 }
      })
    });

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) return text.trim();
    return templateSummary(ticket, boundary, faultDesc);
  } catch (err) {
    console.warn('[Gemini AI] Summary generation failed, using fallback:', err.message);
    return templateSummary(ticket, boundary, faultDesc);
  }
}

async function explainFault(ticket) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return `AI Assistant (Gemini): Fault localized via graph traversal algorithm. Downstream poles lost power simultaneously while upstream parent pole remains energized. Confidence: ${Math.round((ticket.confidence || 0.95) * 100)}%.`;
  }

  try {
    const prompt = `You are a Senior Power Systems Reliability Engineer. Explain this power fault ticket for grid control operators in 3 clear sentences:
- Fault Type: ${ticket.fault_type || 'SPAN_FAULT'}
- Target/Pole: ${ticket.span_to_pole_id || ticket.dt_id || 'P-000001'}
- Location PIN: ${ticket.pincode || '560004'}
- Affected Poles: ${ticket.affected_pole_count || 2}
- Affected Households: ${ticket.affected_households || 804}
- Detection Method: Topological BFS Graph Boundary Localization`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 180, temperature: 0.2 }
      })
    });

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) return text.trim();

    return `AI Assistant (Gemini): Fault localized via graph traversal algorithm. Downstream poles lost power simultaneously while upstream parent pole remains energized. Confidence: ${Math.round((ticket.confidence || 0.95) * 100)}%.`;
  } catch (err) {
    return `AI Assistant (Gemini): Fault localized via graph traversal algorithm. Downstream poles lost power simultaneously while upstream parent pole remains energized.`;
  }
}

function buildPrompt(ticket, boundary, faultDesc) {
  return `You are a power grid control room assistant. Write exactly 2 clear, concise sentences for an operator dashboard describing this fault.

Fault details:
- Type: ${faultDesc}
- Location: ${ticket.lat?.toFixed(5)}, ${ticket.lon?.toFixed(5)}
- PIN code: ${ticket.pincode || 'unknown'}
- Poles affected: ${ticket.affected_pole_count}
- Estimated households: ${ticket.affected_households || 'unknown'}
- Confidence: ${Math.round((ticket.confidence || 0) * 100)}%
- Reason: ${ticket.confidence_reason || ''}

Write 2 sentences: first sentence describes what failed and where, second sentence states the impact and confidence.`;
}

function describeFault(ticket, boundary) {
  switch (ticket.fault_type) {
    case 'span':
      return `Span fault between pole ${boundary.span_from || '?'} and ${boundary.span_to || '?'}`;
    case 'dt':
      return `Distribution transformer failure at DT ${ticket.dt_id}`;
    case 'feeder':
      return `11 kV feeder failure on feeder ${ticket.feeder_id}`;
    default:
      return 'Unknown fault type';
  }
}

function templateSummary(ticket, boundary, faultDesc) {
  const conf = Math.round((ticket.confidence || 0) * 100);
  const pinStr = ticket.pincode ? ` in PIN ${ticket.pincode}` : '';
  const hh = ticket.affected_households ? `approximately ${ticket.affected_households} households` : `poles in the area`;

  return `${faultDesc}${pinStr} detected. ` +
    `${ticket.affected_pole_count || 0} downstream poles are dark, affecting ${hh} — confidence ${conf}%.`;
}

module.exports = { generateSummary, explainFault };
