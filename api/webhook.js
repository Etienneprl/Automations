const https = require("https");
const querystring = require("querystring");

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

function buildMessage(all, formId) {
  const formLabel = FORM_LABELS[formId] || "Contrat";

  let societe = "";
  for (const key of Object.keys(all)) {
    if (key.toLowerCase().includes("soussign") || key.toLowerCase().includes("societe") || key.toLowerCase().includes("société")) {
      societe = all[key];
      break;
    }
  }

  let emailResp = "";
  for (const key of Object.keys(all)) {
    if (key.toLowerCase().includes("responsable") || key.toLowerCase().includes("emailresponsable")) {
      emailResp = all[key];
      break;
    }
  }
  if (!emailResp) {
    emailResp = all["q12_emailResponsable"] || all["q13_emailResponsable"] || all["emailResponsable"] || "";
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
    const body = await new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(data));
    });

    const fields = querystring.parse(body);
    let answers = {};
    if (fields.rawRequest) {
      try { answers = JSON.parse(fields.rawRequest); } catch {}
    }
    const all = { ...fields, ...answers };

    console.log("Clés reçues:", Object.keys(all).join(", "));

    const formId = (fields.formID || fields.form_id || "").toString();
    const text = buildMessage(all, formId);

    await sendSlack(text);
    return res.status(200).send("ok");
  } catch (err) {
    console.error("Erreur:", err);
    return res.status(500).send("error");
  }
};
