let body = $response.body || "";

try {
  const obj = JSON.parse(body);
  console.log("[MyCamera] URL: " + $request.url);
  console.log("[MyCamera] STATUS: " + ($response.status || ""));
  console.log("[MyCamera] RESPONSE: " + JSON.stringify(obj));
} catch (e) {
  console.log("[MyCamera] URL: " + $request.url);
  console.log("[MyCamera] Non-JSON response");
}

$done({});
