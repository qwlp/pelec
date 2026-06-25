#include "ntgcalls.h"
#include "pelec_tgcalls_bridge.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <condition_variable>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

using Json = nlohmann::json;

std::string base64_encode(const uint8_t *data, size_t size) {
  static constexpr char alphabet[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string result;
  result.reserve((size + 2) / 3 * 4);
  for (size_t offset = 0; offset < size; offset += 3) {
    const uint32_t value =
        static_cast<uint32_t>(data[offset]) << 16 |
        (offset + 1 < size ? static_cast<uint32_t>(data[offset + 1]) << 8 : 0) |
        (offset + 2 < size ? static_cast<uint32_t>(data[offset + 2]) : 0);
    result.push_back(alphabet[(value >> 18) & 63]);
    result.push_back(alphabet[(value >> 12) & 63]);
    result.push_back(offset + 1 < size ? alphabet[(value >> 6) & 63] : '=');
    result.push_back(offset + 2 < size ? alphabet[value & 63] : '=');
  }
  return result;
}

std::vector<uint8_t> base64_decode(const std::string &input) {
  std::array<int8_t, 256> table{};
  table.fill(-1);
  const std::string alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (size_t index = 0; index < alphabet.size(); ++index) {
    table[static_cast<uint8_t>(alphabet[index])] = static_cast<int8_t>(index);
  }
  std::vector<uint8_t> result;
  uint32_t value = 0;
  int bits = -8;
  for (const unsigned char character : input) {
    if (character == '=') break;
    const int decoded = table[character];
    if (decoded < 0) continue;
    value = (value << 6) | static_cast<uint32_t>(decoded);
    bits += 6;
    if (bits >= 0) {
      result.push_back(static_cast<uint8_t>((value >> bits) & 0xff));
      bits -= 8;
    }
  }
  return result;
}

char *copy_string(const std::string &value) {
  auto *result = static_cast<char *>(std::malloc(value.size() + 1));
  if (!result) return nullptr;
  std::memcpy(result, value.c_str(), value.size() + 1);
  return result;
}

class AsyncCall {
 public:
  ntg_async_struct value() {
    return {
        this,
        &error_code_,
        &error_message_,
        [](void *context) {
          auto *self = static_cast<AsyncCall *>(context);
          {
            std::lock_guard<std::mutex> lock(self->mutex_);
            self->done_ = true;
          }
          self->condition_.notify_one();
        },
    };
  }

  void wait(int immediate_result) {
    if (immediate_result < 0) {
      throw std::runtime_error("NTgCalls rejected the command: " +
                               std::to_string(immediate_result));
    }
    std::unique_lock<std::mutex> lock(mutex_);
    condition_.wait(lock, [this] { return done_; });
    if (error_code_ < 0) {
      const std::string message =
          error_message_ ? error_message_ : "unknown NTgCalls error";
      std::free(error_message_);
      error_message_ = nullptr;
      throw std::runtime_error(message + " (" + std::to_string(error_code_) + ")");
    }
    if (error_message_) {
      std::free(error_message_);
      error_message_ = nullptr;
    }
  }

 private:
  std::mutex mutex_;
  std::condition_variable condition_;
  bool done_ = false;
  int error_code_ = 0;
  char *error_message_ = nullptr;
};

template <typename Callback>
void run_async(Callback callback) {
  AsyncCall call;
  call.wait(callback(call.value()));
}

struct SourceGroup {
  std::string semantics;
  std::vector<uint32_t> sources;
};

class BridgeInstance {
 public:
  BridgeInstance(pelec_tgcalls_event_callback callback, void *context)
      : callback_(callback), context_(context), instance_(ntg_init()) {
    if (!instance_) throw std::runtime_error("ntg_init failed");
    ntg_on_connection_change(instance_, &BridgeInstance::connection_changed, this);
    ntg_on_signaling_data(instance_, &BridgeInstance::signaling_emitted, this);
    ntg_on_frames(instance_, &BridgeInstance::frames_received, this);
    emit_devices();
  }

  ~BridgeInstance() {
    if (active_id_) {
      try {
        run_async([this](ntg_async_struct future) {
          return ntg_stop(instance_, active_id_, future);
        });
      } catch (...) {
      }
    }
    ntg_destroy(instance_);
  }

  Json command(const Json &request) {
    const std::string command = request.value("command", "");
    const Json payload = request.value("payload", Json::object());
    if (command == "startPrivateSession") return start_private(payload);
    if (command == "receiveSignalingData") return receive_signaling(payload);
    if (command == "createGroupSession") return create_group(payload);
    if (command == "setGroupJoinResponse") return connect_group(payload);
    if (command == "updateGroupParticipants") return update_participants(payload);
    if (command == "setVisibleVideoEndpoints") return set_visible_endpoints(payload);
    if (command == "setMuted") return set_muted(payload.value("muted", false));
    if (command == "setVideoEnabled") return set_video(payload.value("enabled", false));
    if (command == "setDevice") return set_device(payload);
    if (command == "setParticipantVolume") return Json::object();
    if (command == "requestGroupRejoin") return rejoin_group();
    if (command == "stopSession") return stop();
    throw std::runtime_error("Unsupported call engine command: " + command);
  }

 private:
  Json start_private(const Json &payload) {
    stop();
    active_id_ = payload.value("userId", int64_t{0});
    if (!active_id_) throw std::runtime_error("Private call userId is missing");
    group_ = false;
    video_enabled_ = payload.value("isVideo", false);

    run_async([this](ntg_async_struct future) {
      return ntg_create_p2p(instance_, active_id_, future);
    });
    apply_media_sources();
    const auto key = base64_decode(payload.value("encryptionKey", ""));
    run_async([this, &key, &payload](ntg_async_struct future) {
      return ntg_skip_exchange(
          instance_, active_id_, key.data(), static_cast<int>(key.size()),
          payload.value("isOutgoing", false), future);
    });

    std::vector<std::string> owned_strings;
    std::vector<std::vector<uint8_t>> owned_tags;
    std::vector<ntg_rtc_server_struct> servers;
    const auto server_json = payload.value("servers", Json::array());
    const auto versions_json =
        payload.value("protocol", Json::object())
            .value("library_versions", std::vector<std::string>{});
    owned_strings.reserve(server_json.size() * 4 + versions_json.size());
    owned_tags.reserve(server_json.size());
    servers.reserve(server_json.size());
    for (const auto &server : server_json) {
      owned_strings.push_back(server.value("ip_address", ""));
      owned_strings.push_back(server.value("ipv6_address", ""));
      const Json type = server.value("type", Json::object());
      owned_strings.push_back(type.value("username", ""));
      owned_strings.push_back(type.value("password", ""));
      owned_tags.push_back(base64_decode(type.value("peer_tag", "")));
      const size_t string_offset = owned_strings.size() - 4;
      const auto id_text = server.value("id", "0");
      uint64_t id = 0;
      try {
        id = std::stoull(id_text);
      } catch (...) {
      }
      auto &tag = owned_tags.back();
      servers.push_back({
          id,
          owned_strings[string_offset].data(),
          owned_strings[string_offset + 1].data(),
          owned_strings[string_offset + 2].data(),
          owned_strings[string_offset + 3].data(),
          static_cast<uint16_t>(server.value("port", 0)),
          type.value("supports_turn", type.value("_", "") ==
                                          "callServerTypeTelegramReflector"),
          type.value("supports_stun", false),
          type.value("is_tcp", false),
          tag.empty() ? nullptr : tag.data(),
          static_cast<int>(tag.size()),
      });
    }
    owned_strings.insert(
        owned_strings.end(), versions_json.begin(), versions_json.end());
    std::vector<char *> versions;
    const size_t version_offset = owned_strings.size() - versions_json.size();
    for (size_t index = version_offset; index < owned_strings.size(); ++index) {
      versions.push_back(owned_strings[index].data());
    }
    run_async([this, &servers, &versions, &payload](ntg_async_struct future) {
      return ntg_connect_p2p(
          instance_, active_id_, servers.data(), static_cast<int>(servers.size()),
          versions.data(), static_cast<int>(versions.size()),
          payload.value("allowP2p", false), future);
    });
    return Json::object();
  }

  Json receive_signaling(const Json &payload) {
    const auto data = base64_decode(payload.value("data", ""));
    run_async([this, &data](ntg_async_struct future) {
      return ntg_send_signaling_data(
          instance_, active_id_, const_cast<uint8_t *>(data.data()),
          static_cast<int>(data.size()), future);
    });
    return Json::object();
  }

  Json create_group(const Json &payload) {
    stop();
    group_call_id_ = payload.value("groupCallId", int64_t{0});
    if (!group_call_id_) throw std::runtime_error("Group call id is missing");
    active_id_ = -std::abs(group_call_id_);
    group_ = true;
    video_enabled_ = payload.value("isVideo", false);
    char *join_payload = nullptr;
    run_async([this, &join_payload](ntg_async_struct future) {
      return ntg_create(instance_, active_id_, &join_payload, future);
    });
    apply_media_sources();
    const std::string payload_text = join_payload ? join_payload : "{}";
    std::free(join_payload);
    const Json parsed = Json::parse(payload_text);
    return {
        {"audioSourceId", parsed.value("ssrc", 0)},
        {"payload", payload_text},
    };
  }

  Json connect_group(const Json &payload) {
    const std::string response = payload.value("payload", "");
    run_async([this, &response](ntg_async_struct future) {
      return ntg_connect(
          instance_, active_id_, const_cast<char *>(response.c_str()), false,
          future);
    });
    return Json::object();
  }

  Json update_participants(const Json &payload) {
    participant_groups_.clear();
    for (const auto &participant :
         payload.value("participants", Json::array())) {
      const std::string endpoint = participant.value("videoEndpointId", "");
      if (endpoint.empty()) continue;
      std::vector<SourceGroup> groups;
      for (const auto &group :
           participant.value("videoSourceGroups", Json::array())) {
        groups.push_back({
            group.value("semantics", ""),
            group.value("sourceIds", std::vector<uint32_t>{}),
        });
      }
      participant_groups_[endpoint] = std::move(groups);
    }
    refresh_visible_video();
    return Json::object();
  }

  Json set_visible_endpoints(const Json &payload) {
    visible_endpoints_.clear();
    for (const auto &endpoint :
         payload.value("endpointIds", std::vector<std::string>{})) {
      visible_endpoints_.push_back(endpoint);
    }
    refresh_visible_video();
    return Json::object();
  }

  Json set_muted(bool muted) {
    run_async([this, muted](ntg_async_struct future) {
      return muted ? ntg_mute(instance_, active_id_, future)
                   : ntg_unmute(instance_, active_id_, future);
    });
    return Json::object();
  }

  Json set_video(bool enabled) {
    video_enabled_ = enabled;
    apply_media_sources();
    return Json::object();
  }

  Json set_device(const Json &payload) {
    const std::string kind = payload.value("kind", "");
    const std::string device_id = payload.value("deviceId", "");
    if (kind == "audio-input") audio_input_ = device_id;
    if (kind == "audio-output") audio_output_ = device_id;
    if (kind == "camera") camera_ = device_id;
    apply_media_sources();
    return Json::object();
  }

  Json rejoin_group() {
    if (!group_) return Json::object();
    char *join_payload = nullptr;
    run_async([this, &join_payload](ntg_async_struct future) {
      return ntg_create(instance_, active_id_, &join_payload, future);
    });
    const std::string payload_text = join_payload ? join_payload : "{}";
    std::free(join_payload);
    const Json parsed = Json::parse(payload_text);
    emit({
        {"type", "group-join-payload"},
        {"audioSourceId", parsed.value("ssrc", 0)},
        {"payload", payload_text},
    });
    return Json::object();
  }

  Json stop() {
    if (active_id_) {
      const int64_t id = active_id_;
      active_id_ = 0;
      try {
        run_async([this, id](ntg_async_struct future) {
          return ntg_stop(instance_, id, future);
        });
      } catch (...) {
      }
    }
    group_ = false;
    group_call_id_ = 0;
    active_video_ssrc_.clear();
    return Json::object();
  }

  void apply_media_sources() {
    if (!active_id_) return;
    ntg_audio_description_struct microphone{
        NTG_DEVICE,
        audio_input_.data(),
        48000,
        1,
        true,
    };
    ntg_audio_description_struct speaker{
        NTG_DEVICE,
        audio_output_.data(),
        48000,
        2,
        true,
    };
    ntg_video_description_struct camera{
        NTG_DEVICE,
        camera_.data(),
        640,
        360,
        30,
        true,
    };
    ntg_media_description_struct capture{
        &microphone,
        nullptr,
        video_enabled_ ? &camera : nullptr,
        nullptr,
    };
    run_async([this, &capture](ntg_async_struct future) {
      return ntg_set_stream_sources(
          instance_, active_id_, NTG_STREAM_CAPTURE, capture, future);
    });
    ntg_media_description_struct playback{
        nullptr,
        &speaker,
        nullptr,
        nullptr,
    };
    run_async([this, &playback](ntg_async_struct future) {
      return ntg_set_stream_sources(
          instance_, active_id_, NTG_STREAM_PLAYBACK, playback, future);
    });
  }

  void refresh_visible_video() {
    if (!group_ || !active_id_) return;
    for (const auto &[endpoint, ssrc] : active_video_ssrc_) {
      if (std::find(
              visible_endpoints_.begin(), visible_endpoints_.end(), endpoint) ==
          visible_endpoints_.end()) {
        try {
          run_async([this, &endpoint](ntg_async_struct future) {
            return ntg_remove_incoming_video(
                instance_, active_id_, const_cast<char *>(endpoint.c_str()),
                future);
          });
        } catch (...) {
        }
      }
    }
    for (const auto &endpoint : visible_endpoints_) {
      if (active_video_ssrc_.contains(endpoint)) continue;
      const auto found = participant_groups_.find(endpoint);
      if (found == participant_groups_.end() || found->second.empty()) continue;
      std::vector<ntg_ssrc_group_struct> groups;
      for (auto &group : found->second) {
        groups.push_back({
            group.semantics.data(),
            group.sources.data(),
            static_cast<int>(group.sources.size()),
        });
      }
      uint32_t result_ssrc = 0;
      run_async([this, &endpoint, &groups, &result_ssrc](ntg_async_struct future) {
        return ntg_add_incoming_video(
            instance_, active_id_, const_cast<char *>(endpoint.c_str()),
            groups.data(), static_cast<int>(groups.size()), &result_ssrc,
            future);
      });
      active_video_ssrc_[endpoint] = result_ssrc;
      endpoint_by_ssrc_[result_ssrc] = endpoint;
    }
  }

  void emit_devices() {
    ntg_media_devices_struct devices{};
    if (ntg_get_media_devices(&devices) < 0) return;
    if (devices.sizeMicrophone > 0 && devices.microphone[0].metadata) {
      audio_input_ = devices.microphone[0].metadata;
    }
    if (devices.sizeSpeaker > 0 && devices.speaker[0].metadata) {
      audio_output_ = devices.speaker[0].metadata;
    }
    if (devices.sizeCamera > 0 && devices.camera[0].metadata) {
      camera_ = devices.camera[0].metadata;
    }
    Json result = Json::array();
    const auto append = [&result](
                            ntg_device_info_struct *items, int size,
                            const char *kind) {
      for (int index = 0; index < size; ++index) {
        result.push_back({
            {"id", items[index].metadata ? items[index].metadata : ""},
            {"label", items[index].name ? items[index].name : kind},
            {"kind", kind},
            {"selected", index == 0},
        });
      }
    };
    append(devices.microphone, devices.sizeMicrophone, "audio-input");
    append(devices.speaker, devices.sizeSpeaker, "audio-output");
    append(devices.camera, devices.sizeCamera, "camera");
    emit({{"type", "devices"}, {"devices", result}});
  }

  void emit(const Json &event) const {
    if (!callback_) return;
    const std::string serialized = event.dump();
    callback_(
        reinterpret_cast<const uint8_t *>(serialized.data()), serialized.size(),
        context_);
  }

  static void connection_changed(
      uintptr_t, int64_t, ntg_network_info_struct info, void *context) {
    auto *self = static_cast<BridgeInstance *>(context);
    std::string state = "connecting";
    if (info.state == NTG_STATE_CONNECTED) state = "established";
    if (info.state == NTG_STATE_FAILED || info.state == NTG_STATE_TIMEOUT)
      state = "failed";
    if (info.state == NTG_STATE_CLOSED) state = "failed";
    self->emit({{"type", "state"}, {"state", state}});
  }

  static void signaling_emitted(
      uintptr_t, int64_t, uint8_t *data, int size, void *context) {
    auto *self = static_cast<BridgeInstance *>(context);
    self->emit({
        {"type", "signaling"},
        {"data", base64_encode(data, static_cast<size_t>(size))},
    });
  }

  static void frames_received(
      uintptr_t, int64_t, ntg_stream_mode_enum mode,
      ntg_stream_device_enum device, ntg_frame_struct *frames, uint64_t size,
      void *context) {
    auto *self = static_cast<BridgeInstance *>(context);
    if (device != NTG_STREAM_CAMERA && device != NTG_STREAM_SCREEN) return;
    for (uint64_t index = 0; index < size; ++index) {
      const auto &frame = frames[index];
      std::string endpoint = mode == NTG_STREAM_CAPTURE ? "local" : "remote";
      const auto found =
          self->endpoint_by_ssrc_.find(static_cast<uint32_t>(frame.ssrc));
      if (found != self->endpoint_by_ssrc_.end()) endpoint = found->second;
      self->emit({
          {"type", "video-frame"},
          {"endpointId", endpoint},
          {"width", frame.frameData.width},
          {"height", frame.frameData.height},
          {"timestamp", frame.frameData.absoluteCaptureTimestampMs},
          {"data", base64_encode(
                       frame.data, static_cast<size_t>(frame.sizeData))},
      });
    }
  }

  pelec_tgcalls_event_callback callback_ = nullptr;
  void *context_ = nullptr;
  uintptr_t instance_ = 0;
  int64_t active_id_ = 0;
  int64_t group_call_id_ = 0;
  bool group_ = false;
  bool video_enabled_ = false;
  std::string audio_input_;
  std::string audio_output_;
  std::string camera_;
  std::map<std::string, std::vector<SourceGroup>> participant_groups_;
  std::vector<std::string> visible_endpoints_;
  std::map<std::string, uint32_t> active_video_ssrc_;
  std::map<uint32_t, std::string> endpoint_by_ssrc_;
};

const char *get_info_json() {
  ntg_protocol_struct protocol{};
  if (ntg_get_protocol(&protocol) < 0) {
    return copy_string(R"({"error":"ntg_get_protocol failed"})");
  }
  std::vector<std::string> versions;
  for (int index = 0; index < protocol.libraryVersionsSize; ++index) {
    versions.emplace_back(protocol.libraryVersions[index]);
  }
  char *version = nullptr;
  ntg_get_version(&version);
  const Json result{
      {"protocolVersion", 1},
      {"libraryVersions", versions},
      {"minLayer", protocol.minLayer},
      {"maxLayer", protocol.maxLayer},
      {"supportsPrivateVideo", true},
      {"supportsGroupCalls", true},
      {"implementation", "ntgcalls"},
      {"implementationVersion", version ? version : "unknown"},
  };
  std::free(version);
  return copy_string(result.dump());
}

void *create(
    pelec_tgcalls_event_callback callback,
    void *context) {
  try {
    return new BridgeInstance(callback, context);
  } catch (...) {
    return nullptr;
  }
}

void destroy(void *instance) {
  delete static_cast<BridgeInstance *>(instance);
}

const char *command_json(void *instance, const char *command) {
  try {
    if (!instance || !command) throw std::runtime_error("invalid bridge command");
    return copy_string(
        static_cast<BridgeInstance *>(instance)
            ->command(Json::parse(command))
            .dump());
  } catch (const std::exception &error) {
    return copy_string(Json({{"error", error.what()}}).dump());
  }
}

void free_string(const char *value) {
  std::free(const_cast<char *>(value));
}

const pelec_tgcalls_bridge_api api{
    PELEC_TGCALLS_BRIDGE_ABI,
    &get_info_json,
    &create,
    &destroy,
    &command_json,
    &free_string,
};

}  // namespace

extern "C" const pelec_tgcalls_bridge_api *pelec_tgcalls_get_bridge_api() {
  return &api;
}
