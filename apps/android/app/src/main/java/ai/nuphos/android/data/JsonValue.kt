package ai.nuphos.android.data

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * A JSON document as a value type — tool inputs/outputs and `data-*` parts
 * carry arbitrary JSON, and they must round-trip into the transcript we send back.
 */
@Serializable(with = JsonValueSerializer::class)
sealed class JsonValue {
    data object Null : JsonValue()
    data class Bool(val value: Boolean) : JsonValue()
    data class Number(val value: Double) : JsonValue()
    data class Str(val value: String) : JsonValue()
    data class Arr(val value: List<JsonValue>) : JsonValue()
    data class Obj(val value: Map<String, JsonValue>) : JsonValue()

    operator fun get(key: String): JsonValue? = (this as? Obj)?.value?.get(key)
    operator fun get(index: Int): JsonValue? = (this as? Arr)?.value?.getOrNull(index)

    val stringValue: String? get() = (this as? Str)?.value
    val boolValue: Boolean? get() = (this as? Bool)?.value
    val numberValue: Double? get() = (this as? Number)?.value
    val arrayValue: List<JsonValue>? get() = (this as? Arr)?.value
    val objectValue: Map<String, JsonValue>? get() = (this as? Obj)?.value
    val isNull: Boolean get() = this is Null

    val prettyPrinted: String
        get() = if (this is Str) value else jsonPretty.encodeToString(serializer(), this)

    val compact: String
        get() = if (this is Str) value else jsonCompact.encodeToString(serializer(), this)

    companion object {
        private val jsonPretty = Json { prettyPrint = true; encodeDefaults = true }
        private val jsonCompact = Json { encodeDefaults = true }

        fun parse(text: String): JsonValue? = runCatching {
            jsonCompact.decodeFromString(serializer(), text)
        }.getOrNull()

        fun obj(vararg pairs: Pair<String, JsonValue>) = Obj(pairs.toMap())
        fun arr(vararg items: JsonValue) = Arr(items.toList())
    }
}

object JsonValueSerializer : KSerializer<JsonValue> {
    override val descriptor: SerialDescriptor = JsonElement.serializer().descriptor

    override fun serialize(encoder: Encoder, value: JsonValue) {
        val json = encoder as JsonEncoder
        json.encodeJsonElement(value.toElement())
    }

    override fun deserialize(decoder: Decoder): JsonValue {
        val json = decoder as JsonDecoder
        return json.decodeJsonElement().toJsonValue()
    }
}

fun JsonValue.toElement(): JsonElement = when (this) {
    JsonValue.Null -> JsonNull
    is JsonValue.Bool -> JsonPrimitive(value)
    is JsonValue.Number -> {
        val n = value
        if (n == n.toLong().toDouble() && kotlin.math.abs(n) < 1e15) {
            JsonPrimitive(n.toLong())
        } else {
            JsonPrimitive(n)
        }
    }
    is JsonValue.Str -> JsonPrimitive(value)
    is JsonValue.Arr -> JsonArray(value.map { it.toElement() })
    is JsonValue.Obj -> JsonObject(value.mapValues { it.value.toElement() })
}

fun JsonElement.toJsonValue(): JsonValue = when (this) {
    is JsonNull -> JsonValue.Null
    is JsonPrimitive -> {
        val primitive = jsonPrimitive
        when {
            primitive is JsonNull -> JsonValue.Null
            primitive.isString -> JsonValue.Str(primitive.content)
            primitive.booleanOrNull != null -> JsonValue.Bool(primitive.booleanOrNull!!)
            primitive.longOrNull != null -> JsonValue.Number(primitive.longOrNull!!.toDouble())
            primitive.doubleOrNull != null -> JsonValue.Number(primitive.doubleOrNull!!)
            else -> JsonValue.Str(primitive.contentOrNull ?: primitive.content)
        }
    }
    is JsonArray -> JsonValue.Arr(map { it.toJsonValue() })
    is JsonObject -> JsonValue.Obj(mapValues { it.value.toJsonValue() })
}
