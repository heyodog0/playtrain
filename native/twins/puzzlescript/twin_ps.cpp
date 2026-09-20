// twin_ps.cpp — the PuzzleScript twin (U09). Until then the factory reports the family as not built.
#include "twin.hpp"
namespace twin {
std::unique_ptr<Twin> make_puzzlescript_twin(const GameInfo&, std::string& err) { err = "twin: puzzlescript twin not built (U09 pending; the rule VM is gated by tests/test_ps_reference)"; return nullptr; }
}
