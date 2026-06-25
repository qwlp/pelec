#ifndef PELEC_TGCALLS_BRIDGE_H
#define PELEC_TGCALLS_BRIDGE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define PELEC_TGCALLS_BRIDGE_ABI 1

typedef void (*pelec_tgcalls_event_callback)(
    const uint8_t *json,
    size_t json_size,
    void *context);

typedef struct pelec_tgcalls_bridge_api {
  uint32_t abi_version;
  const char *(*get_info_json)();
  void *(*create)(pelec_tgcalls_event_callback callback, void *context);
  void (*destroy)(void *instance);
  const char *(*command_json)(void *instance, const char *command_json);
  void (*free_string)(const char *value);
} pelec_tgcalls_bridge_api;

typedef const pelec_tgcalls_bridge_api *(*pelec_tgcalls_get_bridge_api_fn)();

#ifdef __cplusplus
}
#endif

#endif
