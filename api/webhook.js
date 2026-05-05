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

function hasRib(all) {
  const vals = [all["q3_ajoutDu"], all["q4_transfertRib"], all["ajoutDu"], all["transfertRib"]];
  return vals.some((v) => v && v.toString().trim() !== "" && v !== "[]");
}

// Parse multipart/form-data
function parseMultipart(body, boundary) {
  const result = {};
  const parts = body.split("--" + boundary);
  for (const part of parts) {
    if (!part || part === "--\r\n" || part.trim() === "--") continue;
    const match = part.match(/Content-Disposition: form-data; name="([^"]+)"[\r\n]+([\s\S]*)/);
    if (match) {
      const key = match[1];
      const value = match[2].replace(/\r\n$/, "").trim();
      result[key] = value;
    }
  }
  return result;
}

function buildMessage(all, formId) {
  const formLabel = FORM_LABELS[formId] || "Contrat";

  let societe = "";
  for (const key of Object.keys(all)) {
    const kl = key.toLowerCase();
    if (kl.includes("soussign") || kl.includes("societe") || kl.includes("société")) {
      societe = all[key];
      break;
    }
  }

  let emailResp = "";
  for (const key of Object.keys(all)) {
    const kl = key.toLowerCase();
    if (kl.includes("responsable") || kl.includes("emailresponsable")) {
      emailResp = all[key];
      break;
    }
  }

  const prenom = extractPrenom(emailResp);
  const ribOk = hasRib(all);

  const ribLine = ribOk
    ? "✅ RIB ajouté dans Jotform par le client"
    : "⚠️ RIB non ajouté par le client dans Jotform";

  const nomClient = societe ? `*${societe.trim()}*\n_${formLabel}_` : `_${formLabel}_`;

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
    let all = {};

    if (contentType.includes("multipart/form-data")) {
      const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
      if (boundaryMatch) {
        all = parseMultipart(rawBody, boundaryMatch[1]);
      }
    } else {
      const qs = require("querystring");
      all = qs.parse(rawBody);
      if (all.rawRequest) {
        try { Object.assign(all, JSON.parse(all.rawRequest)); } catch {}
      }
    }

    console.log("Clés reçues:", Object.keys(all).join(", "));
    console.log("Email responsable:", all["q10_emailResponsable"] || all["emailResponsable"] || "non trouvé");

    const formId = (all.formID || all.form_id || "").toString();
    const text = buildMessage(all, formId);

    await sendSlack(text);
    return res.status(200).send("ok");
  } catch (err) {
    console.error("Erreur:", err);
    return res.status(500).send("error");
  }
};
