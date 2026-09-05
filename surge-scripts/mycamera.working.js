let body = $response.body || "";

try {
  const obj = JSON.parse(body);
  console.log("[MyCamera] HIT: " + $request.url);
  console.log("[MyCamera] STATUS: " + ($response.status || ""));
  console.log("[MyCamera] JSON: " + JSON.stringify(obj));
} catch (e) {
  console.log("[MyCamera] HIT: " + $request.url);
  console.log("[MyCamera] BODY-NON-JSON");
}

$done({});
