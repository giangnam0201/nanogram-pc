package app.nanogram.pc.model

import kotlinx.serialization.Serializable

@Serializable
data class GameItem(
    val id: String = "",
    val title: String = "",
    val thumbnailUrl: String = "",
    val authorName: String = "",
    val authorAvatar: String = "",
    val plays: Int = 0,
    val likes: Int = 0,
    val remixes: Int = 0,
    val duration: Int = 60,
    val isRemix: Boolean = false,
    val gameType: String = "blast"
)

@Serializable
data class Comment(
    val id: String = "",
    val userId: String = "",
    val userName: String = "",
    val userAvatar: String = "",
    val text: String = "",
    val timestamp: Long = 0,
    val likes: Int = 0
)

@Serializable
data class ChatMessage(
    val id: String = "",
    val senderId: String = "",
    val senderName: String = "",
    val text: String = "",
    val timestamp: Long = 0,
    val isMe: Boolean = false
)

@Serializable
data class UserProfile(
    val id: String = "me",
    val username: String = "",
    val displayName: String = "",
    val bio: String = "",
    val avatarUrl: String = "",
    val followers: Int = 0,
    val following: Int = 0,
    val gamesCreated: Int = 0,
    val isFollowing: Boolean = false,
    val createdGames: List<GameItem> = emptyList()
)

@Serializable
data class Notification(
    val id: String = "",
    val type: String = "",
    val message: String = "",
    val actorName: String = "",
    val actorAvatar: String = "",
    val timestamp: Long = 0,
    val read: Boolean = false
)

enum class Screen { Home, Discover, Create, Inbox, Profile }
