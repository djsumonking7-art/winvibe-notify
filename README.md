# WinVibe Notify Server (Render) — সেটআপ

## ১. Firebase Service Account
Firebase Console → Project settings → **Service accounts** → *Generate new private key* → একটি `.json` ফাইল নামবে।

## ২. GitHub-এ আপলোড
এই ফোল্ডারটি (`server.js`, `templates.js`, `package.json`, `render.yaml`) একটি নতুন GitHub repo-তে দিন।
(`.json` key ফাইলটা **repo-তে দেবেন না**।)

## ৩. Render-এ Deploy
1. render.com → **New → Web Service** → repo সিলেক্ট করুন (Build: `npm install`, Start: `npm start`, Plan: Free)।
2. **Environment** এ দুটি ভ্যারিয়েবল দিন:
   * `FIREBASE_SERVICE_ACCOUNT` = ডাউনলোড করা json ফাইলের **পুরো লেখা** (পেস্ট)
   * `NOTIFY_LANG` = `bn` (বাংলা) অথবা `en`
3. Deploy শেষে ঠিকানা পাবেন, যেমন `https://winvibe-notify.onrender.com` — `/health` খুলে `{"ok":true}` দেখুন।

## ৪. Admin app-এ বসান
Admin app → **Notification Server** → ঠিকানা পেস্ট → **Save URL** → **Test connection**।
(Player app ও এই ঠিকানাটা Firestore `config/push` থেকে নিজে পড়ে নেয়।)

## ৫. Firestore Rules
প্রজেক্টের `firestore.rules` (নতুন, `fcmTokens` + `adminTokens` সহ) Console-এ Publish করুন।

## ৬. দুটো অ্যাপই নতুন করে বিল্ড/ইনস্টল করুন
* Admin app একবার খুলে notification permission **Allow** দিন (ফোনের টোকেন তখনই সেভ হয়)।
* Player app একবার লগইন করে খুলুন।

## Free plan টিপ
Render Free সার্ভার ১৫ মিনিট নিষ্ক্রিয় থাকলে ঘুমিয়ে যায়; জাগতে ~১ মিনিট লাগে। অ্যাপ নিজে ৩ বার রিট্রাই করে,
আর সার্ভার জাগলে প্রতি মিনিটে মিস হওয়া ইভেন্ট নিজে খুঁজে পাঠায়। দ্রুত নোটিফিকেশনের জন্য
**UptimeRobot** (ফ্রি) দিয়ে প্রতি ৫ মিনিটে `https://…onrender.com/health` পিং করুন।

## লেখা বদলাতে চাইলে
সব নোটিফিকেশন টেক্সট `templates.js` ফাইলে।

## কে কখন কী পায়
| ঘটনা | কে নোটিফিকেশন পায় |
|---|---|
| নতুন রেজিস্ট্রেশন | Admin |
| Add Cash / Withdraw রিকোয়েস্ট | Admin |
| Approve / Reject | ওই Player |
| Push Notification (ছবিসহ) | সব Player |
| নতুন Cashback Offer | সব Player |
