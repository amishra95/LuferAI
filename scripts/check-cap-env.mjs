// Guard for `npm run cap:sync`: the native shells load the deployed site, so a sync
// without CAP_SERVER_URL ships an app that only shows the "not configured" page.
const url = process.env.CAP_SERVER_URL;

if (!url) {
  console.error("✖ CAP_SERVER_URL is not set.\n  Release: CAP_SERVER_URL=https://app.example.com npm run cap:sync\n  Device dev: CAP_SERVER_URL=http://<LAN-IP>:3000 npm run cap:sync");
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(url);
} catch {
  console.error(`✖ CAP_SERVER_URL is not a valid URL: ${url}`);
  process.exit(1);
}

if (parsed.protocol === "http:") {
  console.warn(`⚠ ${url} is plain HTTP — fine for a dev device build, never for a store release (cleartext is enabled only for http URLs).`);
} else if (parsed.protocol !== "https:") {
  console.error(`✖ CAP_SERVER_URL must be http(s): ${url}`);
  process.exit(1);
}

console.log(`✔ Native shells will load ${parsed.origin}`);
