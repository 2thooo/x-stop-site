(() => {
  try {
    const requested = new URLSearchParams(location.search).get("lang");
    if (requested === "ar" || requested === "en") localStorage.setItem("x_loyalty_language", requested);
    const language = localStorage.getItem("x_loyalty_language") === "ar" ? "ar" : "en";
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  } catch {}
})();
