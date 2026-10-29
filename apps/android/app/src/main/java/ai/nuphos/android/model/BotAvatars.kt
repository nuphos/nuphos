package ai.nuphos.android.model

/** Keep the order and code-point hashing identical to Desktop and iOS. */
object BotAvatars {
    val files = listOf(
        "01-vermeer-girl.svg", "02-leonardo.svg", "03-mona-lisa.svg", "04-venus.svg",
        "05-rembrandt.svg", "06-beethoven.svg", "07-ada.svg", "08-socrates.svg",
        "09-frida.svg", "10-van-gogh.svg", "11-mozart.svg", "12-newton.svg",
        "13-shakespeare.svg", "14-napoleon.svg", "15-cleopatra.svg", "16-athena.svg",
        "17-the-scream.svg", "18-american-gothic.svg", "19-the-fifer.svg", "20-son-of-man.svg",
        "21-the-milkmaid.svg", "22-lady-with-an-ermine.svg", "23-girl-with-peaches.svg",
        "24-the-blue-boy.svg", "25-infanta.svg", "26-the-swing.svg", "27-the-astronomer.svg",
        "28-the-sleeping-gypsy.svg",
    )

    fun file(id: String): String {
        var hash = 2166136261u
        var i = 0
        while (i < id.length) {
            val unit = id[i]
            hash = (hash xor unit.code.toUInt()) * 16777619u
            i += if (unit.isHighSurrogate() && i + 1 < id.length && id[i + 1].isLowSurrogate()) 2 else 1
        }
        return files[(hash % files.size.toUInt()).toInt()]
    }
}
