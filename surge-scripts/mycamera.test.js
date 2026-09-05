/**
 * @name myCamera 调试脚本
 * @author doovvip
 * @function 相机
 */

(function () {
  const url = $request.url || "";
  const body = $response.body;

  // 1. 无响应体直接放行
  if (!body) {
    $done({});
    return;
  }

  try {
    let obj = JSON.parse(body);

    console.log("========== [myCamera] 命中目标请求 ==========");
    console.log("拦截 URL: " + url);

    // 2. 注入通用赋值函数
    const injectVip = (target) => {
      if (!target || typeof target !== "object") return;

      // 核心布尔值标记
      target.is_vip = true;
      target.is_vip_expired = false;
      target.is_pro = true;
      target.is_premium = true;
      target.is_subscribed = true;
      target.is_expire = false;
      target.is_valid = true;

      // 状态数值标记 (1 代表启用/生效)
      target.vip_type = 1;
      target.vip_status = 1;
      target.vip_level = 1;
      target.status = 1;
      target.member_type = 1;
      target.membership_type = 1;

      // 永久到期时间戳与格式化时间 (2099-12-31)
      const expireTimestamp = 4102415999;
      const expireString = "2099-12-31 23:59:59";

      target.expire_time = expireString;
      target.vip_expire = expireTimestamp;
      target.vip_expire_time = expireTimestamp;
      target.vip_expiration_time = expireTimestamp;
      target.subscribed_till = expireTimestamp;
      target.subscription_end_date = expireString;
      target.end_time = expireTimestamp;
      target.expires_date = expireString;
      target.expires_date_ms = 4102415999000;

      // 常见会员额外对象包装
      if (typeof target.vip === "object" && target.vip !== null) {
        injectVip(target.vip);
      }
      if (typeof target.membership === "object" && target.membership !== null) {
        injectVip(target.membership);
      }
    };

    // 3. 对不同层级结构进行扫描并注入
    injectVip(obj);

    if (obj.data) {
      if (Array.isArray(obj.data)) {
        obj.data.forEach((item) => injectVip(item));
      } else if (typeof obj.data === "object") {
        injectVip(obj.data);
        if (obj.data.user) injectVip(obj.data.user);
        if (obj.data.userInfo) injectVip(obj.data.userInfo);
      }
    }

    if (obj.result && typeof obj.result === "object") {
      injectVip(obj.result);
    }

    if (obj.user && typeof obj.user === "object") {
      injectVip(obj.user);
    }

    console.log("========== [myCamera] 数据篡改完成 ==========");
    $done({ body: JSON.stringify(obj) });

  } catch (err) {
    console.log("========== [myCamera] JSON 解析异常 ==========");
    console.log("错误信息: " + err.message);
    $done({});
  }
})();
