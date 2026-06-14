import http from "http";

const payload = JSON.stringify({
  audio_base64: "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
  mime_type: "audio/wav",
  settings: {
    provider: "volcengine", 
    apiKey: "test-key"
  }
});
const req = http.request({
  hostname: "127.0.0.1",
  port: 3000,
  path: "/api/transcribe",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload)
  }
}, res => {
  let body = "";
  res.on("data", d => body += d);
  res.on("end", () => console.log(res.statusCode, body));
});
req.write(payload);
req.end();
