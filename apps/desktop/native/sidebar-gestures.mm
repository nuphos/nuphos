#import <AppKit/AppKit.h>
#include <node_api.h>

// Local monitor: only this app's events, with no global input monitoring access.
static id monitor;
static napi_threadsafe_function listener;

static void Stop(void*) {
  if (monitor) [NSEvent removeMonitor:monitor];
  monitor = nil;
  if (listener) napi_release_threadsafe_function(listener, napi_tsfn_abort);
  listener = nullptr;
}

// AppKit invokes monitors outside Node's callback scope. Enter JS through the
// Node-API queue rather than calling V8 directly from the native event loop.
static void CallJS(napi_env env, napi_value callback, void*, void* data) {
  if (!env) return;
  napi_value receiver, value, result;
  napi_get_undefined(env, &receiver);
  napi_create_string_utf8(env, static_cast<const char*>(data), NAPI_AUTO_LENGTH, &value);
  napi_call_function(env, receiver, callback, 1, &value, &result);
}

static void Publish(const char* phase) {
  if (listener) napi_call_threadsafe_function(listener, const_cast<char*>(phase), napi_tsfn_nonblocking);
}

static napi_value Start(napi_env env, napi_callback_info info) {
  Stop(nullptr);
  size_t argc = 1;
  napi_value callback;
  napi_get_cb_info(env, info, &argc, &callback, nullptr, nullptr);
  napi_valuetype type;
  if (argc != 1 || napi_typeof(env, callback, &type) != napi_ok || type != napi_function) {
    napi_throw_type_error(env, nullptr, "Expected a gesture callback");
    return nullptr;
  }
  napi_value name;
  napi_create_string_utf8(env, "SidebarGesture", NAPI_AUTO_LENGTH, &name);
  if (napi_create_threadsafe_function(env, callback, nullptr, name, 32, 1,
      nullptr, nullptr, nullptr, CallJS, &listener) != napi_ok) return nullptr;
  napi_unref_threadsafe_function(env, listener);
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel
    handler:^NSEvent*(NSEvent* event) {
      if (event.phase & (NSEventPhaseBegan | NSEventPhaseMayBegin)) Publish("begin");
      if (event.phase & (NSEventPhaseEnded | NSEventPhaseCancelled)) Publish("end");
      // Momentum never delays release, nor starts another sidebar gesture.
      return event;
    }];
  return nullptr;
}

static napi_value Haptic(napi_env env, napi_callback_info info) {
  [[NSHapticFeedbackManager defaultPerformer]
    performFeedbackPattern:NSHapticFeedbackPatternGeneric
    performanceTime:NSHapticFeedbackPerformanceTimeNow];
  return nullptr;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"start", nullptr, Start, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"haptic", nullptr, Haptic, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 2, methods);
  napi_add_env_cleanup_hook(env, Stop, nullptr);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
