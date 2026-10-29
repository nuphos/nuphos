package ai.nuphos.android.session

import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.data.ConversationActions
import ai.nuphos.android.data.JsonValue
import org.junit.Assert.*
import org.junit.Test

class PinnedListOrderTest {
 private fun row(id: String, parent: String? = null, mine: Boolean = true) = AgentConversation(id,"team",id,parentSessionId=parent,isOwner=mine)
 private fun pins(vararg ids: String) = ids.map { PinnedHistory.Shortcut(it,it) }
 private fun items(rows: List<AgentConversation>, pins: List<PinnedHistory.Shortcut>, folded: Set<String> = emptySet()) = PinnedHistory.items(PinnedHistory.nest(rows,pins,folded,"viewer"),pins)
 private fun ids(items: List<PinnedHistory.Item>) = items.map { when(it) { is PinnedHistory.Item.Loaded -> it.row.conversation.sessionId; is PinnedHistory.Item.Missing -> it.shortcut.sessionId } }
 @Test fun latestPinOrderUnpinAndRepinMatchIos() {
  fun favorites(vararg ids:String)=ConversationActions.Favorites(ids.map { JsonValue.parse("{\"key\":\"agent-session:$it\"}")!! },1)
  val rows=listOf(row("A"),row("B"),row("C"),row("recent"))
  fun order(vararg ids:String)=ids(items(rows,PinnedHistory.shortcuts(favorites(*ids),"",false)))
  assertEquals(listOf("C","B","A","recent"),order("A","B","C"))
  assertEquals(listOf("C","A","B","recent"),order("A","C"))
  assertEquals(listOf("B","C","A","recent"),order("A","C","B"))
 }
 @Test fun loadedUnloadedAndRefreshKeepOneRankedSlot() {
  val pins=pins("C","B","A")
  val first=items(listOf(row("A"),row("recent")),pins)
  assertEquals(listOf("C","B","A","recent"),ids(first))
  assertEquals(2,first.count { it is PinnedHistory.Item.Missing })
  val loaded=items(listOf(row("A"),row("B"),row("C"),row("recent"),row("B")),pins)
  assertEquals(ids(first),ids(loaded));assertTrue(loaded.all { it is PinnedHistory.Item.Loaded })
  assertEquals(loaded.size,loaded.map { it.key }.toSet().size)
 }
 @Test fun unpinnedHistoryKeepsSelectedSourceSortAcrossOwnership() {
  val rows=listOf(row("shared",mine=false),row("mine"),row("old"))
  assertEquals(listOf("shared","mine","old"),ids(items(rows,emptyList())))
  assertEquals(listOf("old","shared","mine"),ids(items(rows,pins("old"))))
 }
 @Test fun parentBlockKeepsUnpinnedChildrenAndFullThreadCount() {
  val rows=listOf(row("parent"),row("child","parent",false),row("leaf","child"),row("other"))
  val result=items(rows,pins("parent"))
  assertEquals(listOf("parent","child","leaf","other"),ids(result))
  assertEquals(listOf(0,1,2,0),result.map { (it as PinnedHistory.Item.Loaded).row.depth })
  assertEquals(2,(result.first() as PinnedHistory.Item.Loaded).row.threads)
  val folded=items(rows,pins("parent"),setOf("parent"))
  assertEquals(listOf("parent","other"),ids(folded))
  assertEquals(listOf("child","leaf"),(folded.first() as PinnedHistory.Item.Loaded).row.hidden.map { it.sessionId })
 }
 @Test fun singlePinnedChildPromotesButBothPinnedRemainNested() {
  val rows=listOf(row("parent"),row("child","parent"),row("other"))
  val child=items(rows,pins("child"))
  assertEquals(listOf("child","parent","other"),ids(child))
  assertEquals(0,(child.first() as PinnedHistory.Item.Loaded).row.depth)
  val both=items(rows,pins("child","parent"))
  assertEquals(listOf("parent","child","other"),ids(both))
  assertEquals(1,(both[1] as PinnedHistory.Item.Loaded).row.depth)
  assertEquals(listOf("child","other"),ids(items(rows.drop(1),pins("child","parent"))).filter { it!="parent" })
 }
 @Test fun refreshedFavoritesAndWorkspaceNeverRetainOldRank() {
  val rows=listOf(row("A"),row("B"),row("C"))
  assertEquals(listOf("C","A","B"),ids(items(rows,pins("C"))))
  assertEquals(listOf("B","A","C"),ids(items(rows,pins("B"))))
  assertEquals(listOf("A","B","C"),ids(items(rows,emptyList())))
  assertEquals(listOf("C","B"),ids(items(emptyList(),pins("C","B","C"))))
 }
}
