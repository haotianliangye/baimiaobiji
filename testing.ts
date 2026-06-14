import 'dotenv/config';

async function test() {
  try {
    const response = await fetch('http://localhost:3000/api/generate-timeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: "2026-06-14",
        timezone: "Asia/Shanghai",
        logs: [{"id": "1", "content": "Started work", "created_at": Date.now()}]
      })
    });
    console.log(response.status);
    console.log(await response.text());
  } catch (e) {
    console.error(e);
  }
}

test();
