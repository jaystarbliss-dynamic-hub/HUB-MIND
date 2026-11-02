package com.example.hubmind.ui.screens.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.hubmind.data.model.*
import com.example.hubmind.data.repository.ConversationRepository
import com.example.hubmind.data.repository.DeviceRegistryRepository
import com.example.hubmind.data.repository.JessRepository
import com.example.hubmind.data.repository.JessRepositoryImpl
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

data class JessHomeUiState(
    val currentConversation: Conversation? = null,
    val messages: List<ChatMessage> = emptyList(),
    val liveState: JessLiveState = JessLiveState.IDLE,
    val connectionState: LiveConnectionState = LiveConnectionState.DISCONNECTED,
    val targetDevice: DeviceNode? = null,
    val isMicActive: Boolean = false,
    val currentInput: String = "",
    val isSending: Boolean = false
)

class JessHomeViewModel(
    private val jessRepository: JessRepository,
    private val conversationRepository: ConversationRepository,
    private val deviceRegistryRepository: DeviceRegistryRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(JessHomeUiState())
    val uiState: StateFlow<JessHomeUiState> = _uiState.asStateFlow()
    private var messagesJob: Job? = null

    init {
        viewModelScope.launch {
            conversationRepository.currentConversation.collect { conv ->
                _uiState.value = _uiState.value.copy(currentConversation = conv)
                conv?.let { loadMessages(it.id) }
            }
        }

        viewModelScope.launch {
            jessRepository.liveState.collect { state ->
                val active = state == JessLiveState.LISTENING ||
                    state == JessLiveState.SPEAKING ||
                    state == JessLiveState.THINKING
                _uiState.value = _uiState.value.copy(
                    liveState = state,
                    isMicActive = if (state == JessLiveState.IDLE || state == JessLiveState.ERROR) false else _uiState.value.isMicActive || active
                )
            }
        }

        viewModelScope.launch {
            jessRepository.connectionState.collect { conn ->
                _uiState.value = _uiState.value.copy(connectionState = conn)
            }
        }

        viewModelScope.launch {
            deviceRegistryRepository.currentTargetDevice.collect { device ->
                _uiState.value = _uiState.value.copy(targetDevice = device)
            }
        }
    }

    private fun loadMessages(conversationId: String) {
        messagesJob?.cancel()
        messagesJob = viewModelScope.launch {
            conversationRepository.getMessages(conversationId).collect { msgList ->
                _uiState.value = _uiState.value.copy(messages = msgList)
            }
        }
    }

    fun onInputChange(text: String) {
        _uiState.value = _uiState.value.copy(currentInput = text)
    }

    fun toggleMic() {
        val next = !_uiState.value.isMicActive
        _uiState.value = _uiState.value.copy(isMicActive = next)
        viewModelScope.launch {
            if (next) {
                val started = jessRepository.startVoiceSession()
                if (!started) {
                    _uiState.value = _uiState.value.copy(isMicActive = false)
                }
            } else {
                jessRepository.endVoiceSession()
            }
        }
    }

    fun sendPrompt(customPrompt: String? = null) {
        val text = (customPrompt ?: _uiState.value.currentInput).trim()
        if (text.isBlank()) return

        val target = _uiState.value.targetDevice?.deviceId
        _uiState.value = _uiState.value.copy(currentInput = "", isSending = true)

        viewModelScope.launch {
            val conv = _uiState.value.currentConversation
                ?: conversationRepository.createConversation(text.take(40))

            conversationRepository.postUserMessage(conv.id, text, target)

            val responseFlow = jessRepository.sendPrompt(text, target)
            var responseText = ""
            responseFlow.collect { chunk ->
                responseText = chunk
            }

            val impl = jessRepository as? JessRepositoryImpl
            conversationRepository.appendJessResponse(
                conversationId = conv.id,
                text = responseText,
                toolName = impl?.lastExecutedToolName,
                status = impl?.lastExecutionStatus
            )

            _uiState.value = _uiState.value.copy(isSending = false)
        }
    }

    fun switchTargetDevice() {
        viewModelScope.launch {
            val list = deviceRegistryRepository.devices.value
            val current = _uiState.value.targetDevice
            val next = list.firstOrNull { it.deviceId != current?.deviceId } ?: list.firstOrNull()
            next?.let { deviceRegistryRepository.selectTargetDevice(it.deviceId) }
        }
    }
}
