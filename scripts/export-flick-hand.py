"""Export the current artist hand. Open blender/pointing-hand-rigged.blend first.

Console invocation: set path to this script, then
exec(compile(open(path).read(), path, 'exec'), {'__file__': path})

The old procedural create-flick-hand.py is retained as historical source;
this entry point exports the artist's updated rig and weights instead.
"""
from pathlib import Path
script = Path(__file__).resolve().with_name('export-pointing-hand.py')
exec(compile(script.read_text(), str(script), 'exec'), {'__file__': str(script)})
