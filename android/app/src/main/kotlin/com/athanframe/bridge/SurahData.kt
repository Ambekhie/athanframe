package com.athanframe.bridge

/**
 * Canonical 114-surah list. Order and English transliterations match the
 * Masjidal app's resources so the `typeS` extra we send back is the exact
 * string the app expects.
 */
object SurahData {
    val NAMES: List<String> = listOf(
        "Al-Fatihah", "Al-Baqarah", "Al-Imran", "An-Nisa", "Al-Maidah",
        "Al-An\u2019am", "Al-A\u2019raf", "Al-Anfal", "At-Taubah", "Yunus",
        "Hud", "Yusuf", "Ar-Ra\u2019d", "Ibrahim", "Al-Hijr",
        "An-Nahl", "Al-Isra", "Al-Kahf", "Maryam", "Taha",
        "Al-Anbiya", "Al-Hajj", "Al-Mu\u2019minun", "An-Noor", "Al-Furqan",
        "Ash-Shuara", "An-Naml", "Al-Qasas", "Al-Ankabut", "Ar-Rum",
        "Luqman", "As-Sajdah", "Al-Ahzab", "Saba", "Fatir",
        "Ya-Sin", "As-Saaffat", "Sad", "Az-Zumar", "Ghafir",
        "Fussilat", "Ash-Shura", "Az-Zukhruf", "Ad-Dukhan", "Al-Jathiyah",
        "Al-Ahqaf", "Muhammad", "Al-Fath", "Al-Hujurat", "Qaf",
        "Adh-Dhariyat", "At-Tur", "An-Najm", "Al-Qamar", "Ar-Rahman",
        "Al-Waqi\u2019ah", "Al-Hadid", "Al-Mujadilah", "Al-Hashr", "Al-Mumtahanah",
        "As-Saff", "Al-Jumu\u2019ah", "Al-Munafiqun", "At-Taghabun", "At-Talaq",
        "At-Tahrim", "Al-Mulk", "Al-Qalam", "Al-Haaqqah", "Al-Ma\u2019arij",
        "Nuh", "Al-Jinn", "Al-Muzzammil", "Al-Muddaththir", "Al-Qiyamah",
        "Al-Insan", "Al-Mursalat", "An-Naba\u2019", "An-Nazi\u2019at", "Abasa",
        "At-Takwir", "Al-Infitar", "Al-Mutaffifin", "Al-Inshiqaq", "Al-Buruj",
        "At-Tariq", "Al-A\u2019la", "Al-Ghashiyah", "Al-Fajr", "Al-Balad",
        "Ash-Shams", "Al-Layl", "Ad-Dhuha", "As-Sharh", "At-Tin",
        "Al-\u2019Alaq", "Al-Qadr", "Al-Bayyinah", "Az-Zalzalah", "Al-\u2019Adiyat",
        "Al-Qari\u2019ah", "At-Takathur", "Al-Asr", "Al-Humazah", "Al-Fil",
        "Al-Quraish", "Al-Ma\u2019un", "Al-Kauther", "Al-Kafiroon", "An-Nasr",
        "Al-Masad", "Al-Ikhlas", "Al-Falaq", "An-Nas"
    )

    init {
        require(NAMES.size == 114) { "surah list must be 114 items" }
    }
}
