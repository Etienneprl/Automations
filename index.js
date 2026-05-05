const http = require("http");
const https = require("https");
const querystring = require("querystring");

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SLACK_TOKEN = process.env.SLACK_TOKEN;        // xoxb-...
const SLACK_CHANNEL = "C05GABK0QTU";               // #sales-
const PORT = process.env.PORT || 3000;

const FORM_LABELS = {
  "251734437755060": "Engagement 1 an",
  "252392928293366": "Sans engagement",
};

// Mapping emails → prénom affiché
const EMAIL_TO_PRENOM = {
  "contact@comoctopus.fr": "Céline",
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function extractPrenom(email) {
  if (!email) return "L'équipe";
  const lower = email.trim().toLowerCase();
  if (EMAIL_TO_PRENOM[lower]) return EMAIL_TO_PRENOM[lower];
  // prenom@domaine.xx → "Prenom"
  const local = email.split("@")[0];
  return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase();
}

function hasRib(fields) {
  // Retourne true si au moins un des champs RIB est rempli
  const ribKeys = [
    "q3_ajoutDu",         // "Ajout du RIB client"
    "q4_transfertRib",    // "Transfert RIB Client"
  ];
  return ribKeys.some((k) => {
    const val = fields[k];
    return val && val.toString().trim() !== "" && val !== "[]";
  });
}

function buildSlackMessage(fields, formId) {
  const formLabel = FORM_LABELS[formId] || "Contrat";

  // Société / dirigeant — champ 1 du formulaire (structure Jotform : q3_contratDe ou similaire)
  // On cherche le champ qui contient le nom société/dirigeant
  const societe =
    fields["q7_entreLesSoussignees"] ||
    fields["q3_contratDe"] ||
    fields["prettyAnswers"]?.find?.((a) => a.name?.toLowerCase().includes("soussign"))?.answer ||
    "";

  const emailResp = fields["q12_emailResponsable"] || fields["q13_emailResponsable"] || "";
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

// ─── SERVEUR ──────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200);
    return res.end("Regata webhook OK");
  }

  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404);
    return res.end("Not found");
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      // Jotform envoie en application/x-www-form-urlencoded
      const fields = querystring.parse(body);

      // rawRequest contient le JSON complet des réponses
      let answers = {};
      if (fields.rawRequest) {
        try { answers = JSON.parse(fields.rawRequest); } catch {}
      }
      // On fusionne fields + answers pour couvrir les deux formats
      const all = { ...fields, ...answers };

      const formId = fields.formID || fields.form_id || "";
      const slackMsg = buildSlackMessage(all, formId);

      console.log(`[${new Date().toISOString()}] Nouveau contrat — form ${formId}`);
      console.log(slackMsg);

      await sendSlack(slackMsg);
      res.writeHead(200);
      res.end("ok");
    } catch (err) {
      console.error("Erreur webhook:", err);
      res.writeHead(500);
      res.end("error");
    }
  });
});

server.listen(PORT, () => {
  console.log(`Webhook Regata démarré sur le port ${PORT}`);
});
