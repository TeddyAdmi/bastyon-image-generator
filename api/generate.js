export default function handler(req, res) {
  console.log("API GENERATE CALLED");
  console.log("METHOD:", req.method);

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).end(JSON.stringify({
      success: false,
      error: "Method not allowed",
      method: req.method
    }));
  }

  return res.status(200).end(JSON.stringify({
    success: true,
    test: true,
    message: "API GENERATE WORKS",
    time: new Date().toISOString()
  }));
}
