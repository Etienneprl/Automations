const https = require("https");
const querystring = require("querystring");

const SLACK_TOKEN = process.env.SLACK_TOKEN;
const SLACK_CHANNEL = "C05GABK0QTU"; // #sales-

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

function hasRib(fields) {
  const vals = [
    fields["q3_ajoutDu"],
    fields["q4_transfertRib"],
    fields["ajoutDu"],
    fields["transfertRib"],
  ];
  return vals.some((v) => v && v.toString().trim() !== "" && v !== "[]");
}

function buildMessage(fields, formId) {
  const formLabel = FORM_LABELS[formId] || "Contrat";

  // Cherche le nom société/dirigeant dans tous les champs possibles
  let societe = "";
  for (const key of Object.keys(fields)) {
    if (key.toLowerCase().includes("soussign") || key.toLowerCase().includes("societe") || key.toLowerCase().includes("société")) {
      societe = fields[key];
      break;
    }
  }

  const emailResp =
    fields["q12_emailResponsable"] ||
    fields["q13_emailResponsable"] ||
    fields["emailResponsable"] ||
    "";

  const prenom = extractPrenom(emailResp);
  const ribOk = hasRib(fields);

  const ribLine = ribOk
    ? "✅ RIB ajouté dans Jotform par le client"
    : "⚠️ RIB non ajouté par le client dans Jotform";

  const nomClient = societe
    ? `*${societe.trim()}*\n_${formLabel}_`
    : `_${formLabel}_`;

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

// Point d'entrée Vercel
module.exports = async (req, res) => {
  if (req.method === "GET") {
    return res.status(200).send("Regata webhook OK");
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    // Lire le body
    const body = await new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(data));
    });

    const fields = querystring.parse(body);

    // rawRequest contient les réponses en JSON
    let answers = {};
    if (fields.rawRequest) {
      try { answers = JSON.parse(fields.rawRequest); } catch {}
    }
    const all = { ...fields, ...answers };

    const formId = (fields.formID || fields.form_id || "").toString();
    const text = buildMessage(all, formId);

    console.log(`Nouveau contrat — form ${formId}`);
    await sendSlack(text);

    return res.status(200).send("ok");
  } catch (err) {
    console.error("Erreur:", err);
    return res.status(500).send("error");
  }
};
