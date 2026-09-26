"""Put this directory on sys.path so the gates can `import ccref` without the
game needing to be an installed package."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
