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
        defaultRequest {
            url(BASE_URL)
            contentType(ContentType.Application.Json)
        }
    }

    private var authToken: String? = null

    suspend fun fetchFeed(): List<GameItem> = try {
        client.get("/games/feed?limit=20").body()
    } catch (e: Exception) { emptyList() }

    suspend fun searchGames(query: String): List<GameItem> = try {
        client.get("/games/search?q=$query").body()
    } catch (e: Exception) { emptyList() }

    suspend fun fetchGame(id: String): GameItem? = try {
        client.get("/games/$id").body()
    } catch (e: Exception) { null }

    suspend fun likeGame(gameId: String) {
        client.post("/games/$gameId/like")
    }

    suspend fun remixGame(gameId: String): GameItem? = try {
        client.post("/games/remix") {
            setBody(mapOf("original_id" to gameId))
        }.body()
    } catch (e: Exception) { null }

    suspend fun createGame(prompt: String, type: String): GameItem? = try {
        client.post("/v2/gamegen/sessions") {
            setBody(mapOf("prompt" to prompt, "type" to type))
        }.body()
    } catch (e: Exception) { null }

    suspend fun fetchComments(gameId: String): List<Comment> = try {
        client.get("/games/$gameId/comments").body()
    } catch (e: Exception) { emptyList() }

    suspend fun postComment(gameId: String, text: String) {
        client.post("/games/$gameId/comments") {
            setBody(mapOf("text" to text))
        }
    }

    suspend fun fetchProfile(userId: String = "me"): UserProfile = try {
        val headers = authToken?.let { mapOf("Authorization" to "Bearer $it") } ?: emptyMap()
        client.get("/users/$userId") { headers.forEach { (k, v) -> header(k, v) } }.body()
    } catch (e: Exception) { UserProfile() }

    suspend fun loginEmail(email: String) {
        client.post("/auth/email") { setBody(mapOf("email" to email)) }
    }

    suspend fun verifyOtp(code: String): Boolean = try {
        val resp: HttpResponse = client.post("/auth/verify") { setBody(mapOf("code" to code)) }
        resp.status == HttpStatusCode.OK
    } catch (e: Exception) { false }

    suspend fun fetchInbox(): List<ChatMessage> = try {
        client.get("/inbox").body()
    } catch (e: Exception) { emptyList() }

    suspend fun sendMessage(recipientId: String, text: String) {
        client.post("/inbox/send") {
            setBody(mapOf("to" to recipientId, "text" to text))
        }
    }

    suspend fun fetchNotifications(): List<Notification> = try {
        client.get("/notifications").body()
    } catch (e: Exception) { emptyList() }

    suspend fun followUser(userId: String) {
        client.post("/users/$userId/follow")
    }

    suspend fun unfollowUser(userId: String) {
        client.post("/users/$userId/unfollow")
    }
}
