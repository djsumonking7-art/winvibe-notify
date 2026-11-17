/**
 * WinVibe — সব নোটিফিকেশনের লেখা এই ফাইলে। বদলাতে চাইলে শুধু এখানে এডিট করুন।
 * NOTIFY_LANG=bn (বাংলা, ডিফল্ট) | en (English)
 */
const LANG = (process.env.NOTIFY_LANG || "bn").toLowerCase() === "en" ? "en" : "bn";

/** 1500 -> "1,500"  |  2500.5 -> "2,500.50" */
const money = (v) => {
  const n = Number(v) || 0;
  return Number.isInteger(n)
    ? n.toLocaleString("en-IN")
    : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const mask = (s) => {
  s = String(s || "");
  return s.length <= 5 ? s : s.slice(0, 3) + "••••" + s.slice(-3);
};
const L = (...lines) => lines.filter(Boolean).join("\n");

const T = {
  bn: {
    // ───────────── Admin ─────────────
    adminRegister: (p) => ({
      title: "🎉 নতুন প্লেয়ার যুক্ত হয়েছেন",
      body: L(
        `নাম: ${p.name}`,
        `মোবাইল: ${p.phone}`,
        p.referred && "সূত্র: রেফারেল কোড",
        p.total && `মোট প্লেয়ার: ${money(p.total)}`
      ),
    }),
    adminDeposit: (p) => ({
      title: `💰 ডিপোজিট রিকোয়েস্ট • ৳${money(p.amount)}`,
      body: L(
        `প্লেয়ার: ${p.name}`,
        `মাধ্যম: ${p.method}`,
        `Transaction ID: ${p.trxId}`,
        "যাচাই করে অনুমোদন করুন।"
      ),
    }),
    adminWithdraw: (p) => ({
      title: `💸 উইথড্র রিকোয়েস্ট • ৳${money(p.amount)}`,
      body: L(
        `প্লেয়ার: ${p.name}`,
        `পরিশোধযোগ্য: ৳${money(p.net)}`,
        `${p.method}: ${p.account}`,
        "যাচাই করে অনুমোদন করুন।"
      ),
    }),

    // ───────────── Player ─────────────
    depositApproved: (p) => ({
      title: "✅ ডিপোজিট সফল",
      body: L(
        `৳${money(p.amount)} আপনার ওয়ালেটে যুক্ত হয়েছে।`,
        p.cashback > 0 && `বোনাস ক্যাশব্যাক: ৳${money(p.cashback)} 🎁`,
        "শুভ খেলা ও শুভকামনা!"
      ),
    }),
    depositRejected: (p) => ({
      title: "ডিপোজিট যাচাই সম্পন্ন হয়নি",
      body: L(
        `৳${money(p.amount)} এর ডিপোজিটটি আমরা যাচাই করতে পারিনি।`,
        "Transaction ID পুনরায় দেখে সাবমিট করুন, অথবা আমাদের সাপোর্ট টিমে যোগাযোগ করুন।"
      ),
    }),
    withdrawApproved: (p) => ({
      title: "✅ উইথড্র সম্পন্ন",
      body: L(
        `৳${money(p.net)} আপনার ${p.method} (${mask(p.account)}) অ্যাকাউন্টে পাঠানো হয়েছে।`,
        "WinVibe-এর সাথে থাকার জন্য ধন্যবাদ।"
      ),
    }),
    withdrawRejected: (p) => ({
      title: "উইথড্র অনুমোদিত হয়নি",
      body: L(
        `৳${money(p.amount)} এর উইথড্র রিকোয়েস্টটি অনুমোদন করা যায়নি।`,
        "আপনার ব্যালেন্স অপরিবর্তিত আছে। বিস্তারিত জানতে সাপোর্ট টিমে যোগাযোগ করুন।"
      ),
    }),

    // ───────────── সব প্লেয়ার (অফার) ─────────────
    offer: (p) => {
      const pct = p.amount > 0 ? Math.round((p.cashback / p.amount) * 100) : 0;
      return {
        title: `🎁 এক্সক্লুসিভ অফার • ৳${money(p.cashback)} ক্যাশব্যাক`,
        body: L(
          `৳${money(p.amount)} Add Cash করুন, ৳${money(p.cashback)} ক্যাশব্যাক পান` + (pct > 0 ? ` (${pct}% বোনাস)।` : "।"),
          "সীমিত সময়ের জন্য প্রযোজ্য।"
        ),
      };
    },
  },

  en: {
    adminRegister: (p) => ({
      title: "🎉 New player registered",
      body: L(
        `Name: ${p.name}`,
        `Mobile: ${p.phone}`,
        p.referred && "Source: referral code",
        p.total && `Total players: ${money(p.total)}`
      ),
    }),
    adminDeposit: (p) => ({
      title: `💰 Deposit request • ৳${money(p.amount)}`,
      body: L(`Player: ${p.name}`, `Method: ${p.method}`, `Transaction ID: ${p.trxId}`, "Please verify and approve."),
    }),
    adminWithdraw: (p) => ({
      title: `💸 Withdraw request • ৳${money(p.amount)}`,
      body: L(`Player: ${p.name}`, `Payable: ৳${money(p.net)}`, `${p.method}: ${p.account}`, "Please verify and approve."),
    }),
    depositApproved: (p) => ({
      title: "✅ Deposit successful",
      body: L(
        `৳${money(p.amount)} has been added to your wallet.`,
        p.cashback > 0 && `Bonus cashback: ৳${money(p.cashback)} 🎁`,
        "Good luck and enjoy the game!"
      ),
    }),
    depositRejected: (p) => ({
      title: "Deposit could not be verified",
      body: L(
        `We could not verify your ৳${money(p.amount)} deposit.`,
        "Please check the Transaction ID and submit again, or contact our support team."
      ),
    }),
    withdrawApproved: (p) => ({
      title: "✅ Withdrawal completed",
      body: L(
        `৳${money(p.net)} has been sent to your ${p.method} account (${mask(p.account)}).`,
        "Thank you for choosing WinVibe."
      ),
    }),
    withdrawRejected: (p) => ({
      title: "Withdrawal not approved",
      body: L(
        `Your ৳${money(p.amount)} withdrawal request could not be approved.`,
        "Your balance is unchanged. Please contact our support team for details."
      ),
    }),
    offer: (p) => {
      const pct = p.amount > 0 ? Math.round((p.cashback / p.amount) * 100) : 0;
      return {
        title: `🎁 Exclusive offer • ৳${money(p.cashback)} cashback`,
        body: L(
          `Add ৳${money(p.amount)} and receive ৳${money(p.cashback)} cashback` + (pct > 0 ? ` (${pct}% bonus).` : "."),
          "For a limited time only."
        ),
      };
    },
  },
};

module.exports = { t: T[LANG], mask, money, LANG };
