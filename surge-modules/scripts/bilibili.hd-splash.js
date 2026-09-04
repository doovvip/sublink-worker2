/***********************************************
 * BiliBili HD/iPad Splash Cleaner
 * Scope: /x/v2/splash/show
 *        /x/v2/splash/list
 *        /x/v2/splash/event/list2
 *        /x/v2/splash/brand/list
 * Status: promoted from EXP-2 after real-device validation.
 * Strategy: keep HTTP success, neutralize splash payload to avoid
 * reject/failure triggering local cached-ad fallback.
 ***********************************************/

const url = $request.url || "";
let body = $response.body || "";

function okEmpty() {
  return JSON.stringify({ code: 0, message: "0", ttl: 1, data: {} });
}

try {
  const obj = JSON.parse(body);

  if (!obj || typeof obj !== "object") {
    $done({ body: okEmpty() });
  } else {
    // Always preserve a successful API envelope.
    if ("code" in obj) obj.code = 0;
    if ("message" in obj) obj.message = "0";
    if ("ttl" in obj) obj.ttl = 1;

    if (!obj.data || typeof obj.data !== "object" || Array.isArray(obj.data)) {
      obj.data = {};
    }

    const data = obj.data;

    // Known splash containers. Empty them instead of rejecting the request.
    const arrayKeys = [
      "list", "show", "events", "event_list", "brand_list",
      "brands", "items", "ads", "ad_list", "splash_list"
    ];
    for (const key of arrayKeys) {
      if (Array.isArray(data[key])) data[key] = [];
    }

    // Known single-ad style fields.
    const objectKeys = [
      "ad", "splash", "brand", "event", "material", "resource"
    ];
    for (const key of objectKeys) {
      if (key in data) {
        if (Array.isArray(data[key])) data[key] = [];
        else if (data[key] && typeof data[key] === "object") data[key] = {};
        else data[key] = null;
      }
    }

    // For the four dedicated endpoints, if nothing recognizable remains,
    // return a valid success envelope with empty data.
    if (/\/x\/v2\/splash\/(?:show|list|event\/list2|brand\/list)(?:\?|$)/.test(url)) {
      body = JSON.stringify(obj);
    } else {
      body = okEmpty();
    }

    $done({ body });
  }
} catch (e) {
  console.log("BiliBili HD Splash: " + e);
  // Parsing failure: return HTTP-success-shaped empty payload rather than reject.
  $done({ body: okEmpty() });
}
