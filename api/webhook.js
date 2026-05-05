const https = require("https");

const SLACK_TOKEN = process.env.SLACK_TOKEN;
const SLACK_CHANNEL = "C05GABK0QTU";

const FORM_LABELS = {
  "251734437755060": "Engagement 1 an",
  "252392928293366": "Sans engagement",
};

const EMAIL_TO_PRENOM = {
  "contact@comoctopus.fr": "Céline",
};

function extractPrenom(email) {
  if (!email) return "L'équipe";
  const lower = email.trim().toLowerCase();
  if (EMAIL_TO_PRENOM[lower]) return EMAIL_TO_PRENOM[lower];
  const local = email.split("@")[0];
  return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase();
}

function hasRib(answers) {
  return Object.entries(answers).some(([k, v]) => {
    const kl = k.toLowerCase();
    if (!kl.includes("rib") && !kl.includes("transfert")) return false;
    const val = typeof v === "object" ? JSON.stringify(v) : String(v);
    return val.trim() !== "" && val !== "[]" && val !== "{}";
  });
}

function findEmail(answers) {
  for (const [k, v] of Object.entries(answers)) {
    const kl = k.toLowerCase();
    if (kl.includes("responsable") || kl.includes("emailresponsable")) {
      return typeof v === "object" ? (v.email || "") : String(v);
    }
  }
  return "";
}

function findSociete(answers) {
  for (const [k, v] of Object.entries(answers)) {
    const kl = k.toLowerCase();
    if (kl.includes("soussign") || kl.includes("societe") || kl.includes("société")) {
      if (typeof v === "object") {
        return Object.values(v).filter(Boolean).join(" ").trim();
      }
      return String(v).trim();
    }
  }
  return "";
}

function parseMultipart(body, boundary) {
  const result = {};
  const parts = body.split("--" + boundary);
  for (const part of parts) {
    if (!part || part.trim() === "--") continue;
    const match = part.match(/Content-Disposition: form-data; name="([^"]+)"[\r\n]+([\s\S]*)/);
    if (match) {
      result[match[1]] = match[2].replace(/\r\n$/, "").trim();
    }
  }
  return result;
}

function buildMessage(answers, formId) {
  const formLabel = FORM_LABELS[formId] || "Contrat";
  const societe = findSociete(answers);
  const emailResp = findEmail(answers);
  const prenom = extractPrenom(emailResp);
  const ribOk = hasRib(answers);

  console.log("societe:", societe, "| email:", emailResp, "| rib:", ribOk);

  const ribLine = ribOk
    ? "✅ RIB ajouté dans Jotform par le client"
    : "⚠️ RIB non ajouté par le client dans Jotform";

  const nomClient = societe ? `*${societe}*\n_${formLabel}_` : `_${formLabel}_`;
  return `Nouveau contrat signé par ${prenom} ⛵\n${nomClient}\n\n${ribLine}`;
}

function sendSlack(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ channel: SLACK_CHANNEL, text });
    const options = {
      hostname: "slack.com",
      path: "/api/chat.postMessage",
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${SLACK_TOKEN}`,
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(JSON.parse(data)));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method === "GET") return res.status(200).send("Regata webhook OK");
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const rawBody = await new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(data));
    });

    const contentType = req.headers["content-type"] || "";
    let fields = {};

    if (contentType.includes("multipart/form-data")) {
      const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
      if (boundaryMatch) fields = parseMultipart(rawBody, boundaryMatch[1]);
    } else {
      fields = require("querystring").parse(rawBody);
    }

    // Les vraies réponses sont dans rawRequest (JSON)
    let answers = {};
    if (fields.rawRequest) {
      try { answers = JSON.parse(fields.rawRequest); } catch {}
    }

    console.log("Clés answers:", Object.keys(answers).join(", "));

    const formId = (fields.formID || fields.form_id || "").toString();
    const text = buildMessage(answers, formId);

    await sendSlack(text);
    return res.status(200).send("ok");
  } catch (err) {
    console.error("Erreur:", err);
    return res.status(500).send("error");
  }
};
