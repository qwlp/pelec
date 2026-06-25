#include "pelec_tgcalls_bridge.h"

#include <arpa/inet.h>
#include <dlfcn.h>
#include <nlohmann/json.hpp>
#include <unistd.h>

#include <array>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace {

using Json = nlohmann::json;
constexpr uint32_t kMaxMessageBytes = 1024 * 1024;
std::mutex output_mutex;

bool read_exact(std::istream &stream, char *data, size_t size) {
  stream.read(data, static_cast<std::streamsize>(size));
  return stream.good() || static_cast<size_t>(stream.gcount()) == size;
}

void write_message(const Json &message) {
  const std::string payload = message.dump();
  if (payload.size() > kMaxMessageBytes) {
    return;
  }
  const uint32_t network_size = htonl(static_cast<uint32_t>(payload.size()));
  std::lock_guard<std::mutex> lock(output_mutex);
  std::cout.write(reinterpret_cast<const char *>(&network_size), sizeof(network_size));
  std::cout.write(payload.data(), static_cast<std::streamsize>(payload.size()));
  std::cout.flush();
}

std::optional<Json> read_message() {
  uint32_t network_size = 0;
  if (!read_exact(std::cin, reinterpret_cast<char *>(&network_size), sizeof(network_size))) {
    return std::nullopt;
  }
  const uint32_t size = ntohl(network_size);
  if (size > kMaxMessageBytes) {
    throw std::runtime_error("incoming command exceeds the 1 MB limit");
  }
  std::string payload(size, '\0');
  if (!read_exact(std::cin, payload.data(), payload.size())) {
    throw std::runtime_error("truncated command");
  }
  return Json::parse(payload);
}

class Bridge {
 public:
  Bridge() {
    const char *configured = std::getenv("PELEC_TGCALLS_BRIDGE_PATH");
    std::vector<std::filesystem::path> candidates;
    if (configured && *configured) {
      candidates.emplace_back(configured);
    }
    candidates.emplace_back(
        std::filesystem::path("/usr/lib/pelec/libpelec-tgcalls.so"));
    std::array<char, 4096> executable_path{};
    const auto executable_size = readlink(
        "/proc/self/exe", executable_path.data(), executable_path.size() - 1);
    if (executable_size > 0) {
      executable_path[static_cast<size_t>(executable_size)] = '\0';
      candidates.emplace_back(
          std::filesystem::path(executable_path.data()).parent_path() /
          "libpelec-tgcalls.so");
    }
    candidates.emplace_back(
        std::filesystem::current_path() / "libpelec-tgcalls.so");

    for (const auto &candidate : candidates) {
      handle_ = dlopen(candidate.c_str(), RTLD_NOW | RTLD_LOCAL);
      if (handle_) {
        break;
      }
    }
    if (!handle_) {
      return;
    }
    auto get_api = reinterpret_cast<pelec_tgcalls_get_bridge_api_fn>(
        dlsym(handle_, "pelec_tgcalls_get_bridge_api"));
    if (!get_api) {
      return;
    }
    api_ = get_api();
    if (!api_ || api_->abi_version != PELEC_TGCALLS_BRIDGE_ABI) {
      api_ = nullptr;
      return;
    }
    instance_ = api_->create(&Bridge::emit_event, this);
  }

  ~Bridge() {
    if (api_ && instance_) {
      api_->destroy(instance_);
    }
    if (handle_) {
      dlclose(handle_);
    }
  }

  bool available() const { return api_ && instance_; }

  Json info() const {
    if (!available()) {
      return {
          {"protocolVersion", 1},
          {"libraryVersions", Json::array()},
          {"maxLayer", 92},
          {"supportsPrivateVideo", false},
          {"supportsGroupCalls", false},
          {"error", "libpelec-tgcalls.so is not installed"},
      };
    }
    return parse_bridge_result(api_->get_info_json());
  }

  Json command(const Json &command) const {
    if (!available()) {
      throw std::runtime_error(
          "Telegram tgcalls bridge is not installed or has an incompatible ABI");
    }
    const Json result =
        parse_bridge_result(api_->command_json(instance_, command.dump().c_str()));
    if (result.contains("error")) {
      throw std::runtime_error(result.value("error", "tgcalls bridge command failed"));
    }
    return result;
  }

 private:
  static void emit_event(
      const uint8_t *json,
      size_t json_size,
      void *context) {
    if (!context || !json || json_size == 0 || json_size > kMaxMessageBytes) {
      return;
    }
    try {
      const auto event = Json::parse(
          reinterpret_cast<const char *>(json),
          reinterpret_cast<const char *>(json) + json_size);
      write_message({{"event", event}});
    } catch (...) {
    }
  }

  Json parse_bridge_result(const char *value) const {
    if (!value) {
      throw std::runtime_error("tgcalls bridge returned no result");
    }
    const std::string copy(value);
    if (api_ && api_->free_string) {
      api_->free_string(value);
    }
    return Json::parse(copy);
  }

  void *handle_ = nullptr;
  const pelec_tgcalls_bridge_api *api_ = nullptr;
  void *instance_ = nullptr;
};

}  // namespace

int main() {
  std::ios::sync_with_stdio(false);
  Bridge bridge;

  try {
    while (const auto message = read_message()) {
      const std::string id = message->value("id", "");
      const std::string command = message->value("command", "");
      if (command == "shutdown") {
        if (!id.empty()) {
          write_message({{"id", id}, {"ok", true}, {"result", Json::object()}});
        }
        break;
      }

      try {
        Json result;
        if (command == "getInfo") {
          result = bridge.info();
        } else {
          result = bridge.command(*message);
        }
        if (!id.empty()) {
          write_message({{"id", id}, {"ok", true}, {"result", result}});
        }
      } catch (const std::exception &error) {
        if (!id.empty()) {
          write_message({{"id", id}, {"ok", false}, {"error", error.what()}});
        }
      }
    }
  } catch (const std::exception &error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
  return 0;
}
