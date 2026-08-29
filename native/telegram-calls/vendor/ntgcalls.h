//
// NTgCalls C ABI v2.2.5. Copyright the NTgCalls contributors.
// Distributed under LGPL-3.0; https://github.com/pytgcalls/ntgcalls
//
#pragma once

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    NTG_FILE = 1 << 0,
    NTG_SHELL = 1 << 1,
    NTG_FFMPEG = 1 << 2,
    NTG_DEVICE = 1 << 3,
    NTG_DESKTOP = 1 << 4,
    NTG_EXTERNAL = 1 << 5
} ntg_media_source_enum;

typedef enum {
    NTG_STREAM_MICROPHONE,
    NTG_STREAM_SPEAKER,
    NTG_STREAM_CAMERA,
    NTG_STREAM_SCREEN
} ntg_stream_device_enum;

typedef enum { NTG_STREAM_CAPTURE, NTG_STREAM_PLAYBACK } ntg_stream_mode_enum;
typedef enum { NTG_STREAM_AUDIO, NTG_STREAM_VIDEO } ntg_stream_type_enum;
typedef enum { NTG_ACTIVE, NTG_PAUSED, NTG_IDLING } ntg_stream_status_enum;
typedef enum {
    NTG_STATE_CONNECTING,
    NTG_STATE_CONNECTED,
    NTG_STATE_TIMEOUT,
    NTG_STATE_FAILED,
    NTG_STATE_CLOSED,
} ntg_connection_state_enum;
typedef enum { NTG_KIND_NORMAL, NTG_KIND_PRESENTATION } ntg_connection_kind_enum;

typedef struct {
    ntg_connection_kind_enum kind;
    ntg_connection_state_enum state;
} ntg_network_info_struct;

typedef struct {
    ntg_media_source_enum mediaSource;
    char *input;
    uint32_t sampleRate;
    uint8_t channelCount;
    bool keepOpen;
} ntg_audio_description_struct;

typedef struct {
    ntg_media_source_enum mediaSource;
    char *input;
    int16_t width;
    int16_t height;
    uint8_t fps;
    bool keepOpen;
} ntg_video_description_struct;

typedef struct {
    ntg_audio_description_struct *microphone;
    ntg_audio_description_struct *speaker;
    ntg_video_description_struct *camera;
    ntg_video_description_struct *screen;
} ntg_media_description_struct;

typedef struct {
    bool muted;
    bool videoPaused;
    bool videoStopped;
    bool presentationPaused;
} ntg_media_state_struct;

typedef struct {
    uint64_t id;
    char *ipv4;
    char *ipv6;
    char *username;
    char *password;
    uint16_t port;
    bool turn;
    bool stun;
    bool tcp;
    uint8_t *peerTag;
    int peerTagSize;
} ntg_rtc_server_struct;

typedef struct {
    int32_t minLayer;
    int32_t maxLayer;
    bool udpP2P;
    bool udpReflector;
    char **libraryVersions;
    int libraryVersionsSize;
} ntg_protocol_struct;

typedef struct {
    int64_t absoluteCaptureTimestampMs;
    uint16_t width;
    uint16_t height;
    uint16_t rotation;
} ntg_frame_data_struct;

typedef struct {
    char *semantics;
    uint32_t *ssrcs;
    int sizeSsrcs;
} ntg_ssrc_group_struct;

typedef void (*ntg_async_callback)(void *);
typedef struct {
    void *userData;
    int *errorCode;
    char **errorMessage;
    ntg_async_callback promise;
} ntg_async_struct;

typedef struct {
    char *name;
    char *metadata;
} ntg_device_info_struct;

typedef struct {
    ntg_device_info_struct *microphone;
    int sizeMicrophone;
    ntg_device_info_struct *speaker;
    int sizeSpeaker;
    ntg_device_info_struct *camera;
    int sizeCamera;
    ntg_device_info_struct *screen;
    int sizeScreen;
} ntg_media_devices_struct;

typedef struct {
    int64_t ssrc;
    uint8_t *data;
    int sizeData;
    ntg_frame_data_struct frameData;
} ntg_frame_struct;

typedef void (*ntg_connection_callback)(
    uintptr_t, int64_t, ntg_network_info_struct, void *);
typedef void (*ntg_signaling_callback)(
    uintptr_t, int64_t, uint8_t *, int, void *);
typedef void (*ntg_frame_callback)(
    uintptr_t, int64_t, ntg_stream_mode_enum, ntg_stream_device_enum,
    ntg_frame_struct *, uint64_t, void *);

uintptr_t ntg_init();
int ntg_destroy(uintptr_t ptr);
int ntg_create_p2p(uintptr_t ptr, int64_t userId, ntg_async_struct future);
int ntg_skip_exchange(
    uintptr_t ptr, int64_t userId, const uint8_t *encryptionKey, int size,
    bool isOutgoing, ntg_async_struct future);
int ntg_connect_p2p(
    uintptr_t ptr, int64_t userId, ntg_rtc_server_struct *servers,
    int serversSize, char **versions, int versionsSize, bool p2pAllowed,
    ntg_async_struct future);
int ntg_send_signaling_data(
    uintptr_t ptr, int64_t userId, uint8_t *buffer, int size,
    ntg_async_struct future);
int ntg_get_protocol(ntg_protocol_struct *buffer);
int ntg_create(
    uintptr_t ptr, int64_t chatId, char **buffer, ntg_async_struct future);
int ntg_connect(
    uintptr_t ptr, int64_t chatId, char *params, bool isPresentation,
    ntg_async_struct future);
int ntg_add_incoming_video(
    uintptr_t ptr, int64_t chatId, char *endpoint,
    ntg_ssrc_group_struct *ssrcGroups, int size, uint32_t *buffer,
    ntg_async_struct future);
int ntg_remove_incoming_video(
    uintptr_t ptr, int64_t chatId, char *endpoint, ntg_async_struct future);
int ntg_set_stream_sources(
    uintptr_t ptr, int64_t chatId, ntg_stream_mode_enum streamMode,
    ntg_media_description_struct desc, ntg_async_struct future);
int ntg_pause(uintptr_t ptr, int64_t chatId, ntg_async_struct future);
int ntg_resume(uintptr_t ptr, int64_t chatId, ntg_async_struct future);
int ntg_mute(uintptr_t ptr, int64_t chatId, ntg_async_struct future);
int ntg_unmute(uintptr_t ptr, int64_t chatId, ntg_async_struct future);
int ntg_stop(uintptr_t ptr, int64_t chatId, ntg_async_struct future);
int ntg_get_media_devices(ntg_media_devices_struct *buffer);
int ntg_on_connection_change(
    uintptr_t ptr, ntg_connection_callback callback, void *userData);
int ntg_on_signaling_data(
    uintptr_t ptr, ntg_signaling_callback callback, void *userData);
int ntg_on_frames(uintptr_t ptr, ntg_frame_callback callback, void *userData);
int ntg_get_version(char **buffer);

#ifdef __cplusplus
}
#endif
