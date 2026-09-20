#include "vfs.hpp"
#ifdef TWIN_WASM
namespace twin {
bool readFile(const std::string& path, std::string& out) {
  for (int i = 0; i < twin_embedded_count; i++) if (path == twin_embedded_files[i].path) { out.assign((const char*)twin_embedded_files[i].data, twin_embedded_files[i].size); return true; }
  return false;
}
}
#else
#include <fstream>
#include <iterator>
namespace twin {
bool readFile(const std::string& path, std::string& out) {
  std::ifstream f(path, std::ios::binary); if (!f) return false;
  out.assign((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>()); return true;
}
}
#endif
