package app.nanogram.pc.api

import app.nanogram.pc.model.*
import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.cio.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.json.Json

object ApiClient {
    private const val BASE_URL = "https://api.nanogram.app"

    val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    private val client = HttpClient(CIO) {
        install(ContentNegotiation) { json(json) }
    }

    private var authToken: String? = null

    private suspend inline fun <reified T> get(path: String): T =
        client.get("$BASE_URL$path") { contentType(ContentType.Application.Json) }.body()

    private suspend fun post(path: String, body: Any? = null): HttpResponse {
        return client.post("$BASE_URL$path") {
            contentType(ContentType.Application.Json)
            if (body != null) setBody(body)
        }
    }

    suspend fun fetchFeed(): List<GameItem> = try {
        get("/games/feed?limit=20")
    } catch (e: Exception) { emptyList() }

    suspend fun searchGames(query: String): List<GameItem> = try {
        get("/games/search?q=$query")
    } catch (e: Exception) { emptyList() }

    suspend fun fetchGame(id: String): GameItem? = try {
        get("/games/$id")
    } catch (e: Exception) { null }

    suspend fun likeGame(gameId: String) {
        post("/games/$gameId/like")
    }

    suspend fun remixGame(gameId: String): GameItem? = try {
        post("/games/remix", mapOf("original_id" to gameId)).body()
    } catch (e: Exception) { null }

    suspend fun createGame(prompt: String, type: String): GameItem? = try {
        post("/v2/gamegen/sessions", mapOf("prompt" to prompt, "type" to type)).body()
    } catch (e: Exception) { null }

    suspend fun fetchComments(gameId: String): List<Comment> = try {
        get("/games/$gameId/comments")
    } catch (e: Exception) { emptyList() }

    suspend fun fetchProfile(userId: String = "me"): UserProfile = try {
        get("/users/$userId")
    } catch (e: Exception) { UserProfile() }

    suspend fun loginEmail(email: String) {
        post("/auth/email", mapOf("email" to email))
    }

    suspend fun verifyOtp(code: String): Boolean = try {
        post("/auth/verify", mapOf("code" to code)).status == HttpStatusCode.OK
    } catch (e: Exception) { false }

    suspend fun fetchInbox(): List<ChatMessage> = try {
        get("/inbox")
    } catch (e: Exception) { emptyList() }

    suspend fun sendMessage(recipientId: String, text: String) {
        post("/inbox/send", mapOf("to" to recipientId, "text" to text))
    }

    suspend fun fetchNotifications(): List<Notification> = try {
        get("/notifications")
    } catch (e: Exception) { emptyList() }
}
