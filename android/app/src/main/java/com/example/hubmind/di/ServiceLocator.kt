package com.example.hubmind.di

import android.content.Context
import com.example.hubmind.agent.AndroidUiActionExecutor
import com.example.hubmind.data.remote.HubMindBackendClient
import com.example.hubmind.data.repository.*
import com.example.hubmind.data.transport.HubMindControlPlaneTransport
import com.example.hubmind.data.transport.HubMindControlPlaneTransportImpl
import com.example.hubmind.data.updater.HubMindUpdateChecker

object ServiceLocator {
    private var appContext: Context? = null

    fun initialize(context: Context) {
        appContext = context.applicationContext
    }

    val backendClient: HubMindBackendClient by lazy {
        HubMindBackendClient(appContext)
    }

    val androidUiActionExecutor: AndroidUiActionExecutor by lazy {
        AndroidUiActionExecutor(requireNotNull(appContext))
    }

    val controlPlaneTransport: HubMindControlPlaneTransport by lazy {
        HubMindControlPlaneTransportImpl(
            backendClient = backendClient,
            localExecutor = appContext?.let { androidUiActionExecutor }
        )
    }

    val conversationRepository: ConversationRepositoryImpl by lazy {
        ConversationRepositoryImpl(backendClient = backendClient)
    }

    val deviceRegistryRepository: DeviceRegistryRepositoryImpl by lazy {
        DeviceRegistryRepositoryImpl(
            context = appContext,
            backendClient = backendClient,
            controlPlaneTransport = controlPlaneTransport
        )
    }

    val authRepository: AuthRepositoryImpl by lazy {
        AuthRepositoryImpl(
            backendClient = backendClient,
            onUserAuthenticated = { user ->
                conversationRepository.bindToUser(user.id)
                deviceRegistryRepository.bindToUser(user.id)
                jessRepository.observeSessionLease(user.id)
            }
        )
    }

    val deviceControlRepository: DeviceControlRepositoryImpl by lazy {
        DeviceControlRepositoryImpl(
            transports = emptyList(),
            localExecutor = appContext?.let { androidUiActionExecutor },
            controlPlaneTransport = controlPlaneTransport,
            authRepository = authRepository,
            localDeviceIdProvider = { deviceRegistryRepository.localDeviceId }
        )
    }

    val jessRepository: JessRepositoryImpl by lazy {
        JessRepositoryImpl(
            conversationRepository = conversationRepository,
            deviceControlRepository = deviceControlRepository,
            deviceRegistryRepository = deviceRegistryRepository,
            backendClient = backendClient,
            authRepository = authRepository,
            context = appContext
        )
    }

    val androidAgentController: AndroidAgentController by lazy {
        AndroidAgentControllerImpl(requireNotNull(appContext))
    }

    val permissionStatusRepository: PermissionStatusRepositoryImpl by lazy {
        PermissionStatusRepositoryImpl(appContext)
    }

    val voiceInteractionRepository: VoiceInteractionRepository by lazy {
        VoiceInteractionRepositoryImpl()
    }

    val updateChecker: HubMindUpdateChecker by lazy {
        HubMindUpdateChecker(requireNotNull(appContext))
    }
}
