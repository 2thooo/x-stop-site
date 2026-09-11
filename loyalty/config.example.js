window.LOYALTY_CONFIG = Object.freeze({
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-PUBLIC-PUBLISHABLE-OR-ANON-KEY",
  functionName: "loyalty-api",
  basePath: "/x-stop-site/loyalty",
  business: {
    name: "X Entertainment RAK Mall",
    shortName: "X Group",
    groupName: "X Group",
    branch: "RAK Mall",
    tagline: "Your play, rewarded.",
    rewardText: "10 points unlock an activity reward",
    phone: "+971 54 731 0073",
    hours: "Daily · 10 AM–12 AM",
    address: "RAK Mall · Al Qurum · Ras Al Khaimah",
    primaryColor: "#650FFD",
    accentColor: "#FFD21A"
  },
  bookingVenues: [
    { slug: "x-entertainment", name: "X Entertainment RAK Mall", nameAr: "إكس إنترتينمنت – راك مول", shortName: "RAK Mall", shortNameAr: "راك مول", city: "Ras Al Khaimah", cityAr: "رأس الخيمة", phone: "+971 54 731 0073", whatsapp: "971547310073", address: "RAK Mall, Al Qurum, Ras Al Khaimah", addressAr: "راك مول، القرم، رأس الخيمة", mapUrl: "https://www.google.com/maps?cid=12180427487395956802", image: "assets/venue-x-entertainment.jpg", activitySlugs: ["laser-tag", "bowling", "escape-room", "billiard", "gaming", "others", "vr", "car"], activities: ["Laser Tag", "Bowling", "Escape Room", "Billiard", "PC & PlayStation", "Others", "VR", "Car"], activitiesAr: ["ليزر تاغ", "البولينغ", "غرفة الهروب", "البلياردو", "ألعاب الكمبيوتر والبلايستيشن", "أنشطة أخرى", "الواقع الافتراضي", "السيارات"] },
    { slug: "master-bowling", name: "Masters Bowling", nameAr: "ماسترز بولينغ", shortName: "Masters", shortNameAr: "ماسترز", city: "Ras Al Khaimah", cityAr: "رأس الخيمة", phone: "+971 54 719 0018", whatsapp: "971547190018", address: "Opposite Naeem Mall, Al Nakheel, Ras Al Khaimah", addressAr: "مقابل النعيم مول، النخيل، رأس الخيمة", mapUrl: "https://www.google.com/maps?cid=6477996226481961738", image: "assets/venue-master-bowling.jpg", activitySlugs: ["bowling", "billiard"], activities: ["Bowling", "Billiard"], activitiesAr: ["البولينغ", "البلياردو"] }
  ]
});
