// Workers are told not to type names or personal details. This is a backstop:
// it strips the identifiers that are easy to spot before the text leaves the
// server. It can't catch names, so the AI also flags text that looks like it
// contains one and the page reminds the worker.
const PATTERNS = [
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[email removed]"],
  [/\b\d{3}-\d{2}-\d{4}\b/g, "[SSN removed]"],
  [/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone removed]"],
  [/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, "[date removed]"],
  [/\b[A-Z]{2}\d{5}[A-Z]\b/g, "[ID removed]"], // NY Medicaid CIN
  [/\b\d{9,}\b/g, "[number removed]"], // MRNs, case numbers, account numbers
];

export function redact(text) {
  let out = text;
  let changed = false;
  for (const [re, label] of PATTERNS) {
    out = out.replace(re, () => {
      changed = true;
      return label;
    });
  }
  return { text: out, changed };
}
