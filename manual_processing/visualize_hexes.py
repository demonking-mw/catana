
def print_grid(name, grid_str):
    print(f"\n--- {name} ---")
    print(grid_str)

# Variant 1: Flat-topped, compact (Tessellated)
# This is the standard "honeycomb" look in ASCII.
# Checks: Shared edges are clear.
grid_compact = """
  _   _   _   _
 / \_/ \_/ \_/ \_
 \_/ \_/ \_/ \_/
 / \_/ \_/ \_/ \_
 \_/ \_/ \_/ \_/
"""

# Variant 2: Pointy-topped, spaced out (Clean)
# This avoids any overlapping characters.
# Hex:
#    / \
#   |   |
#    \ /
grid_spaced = """
     / \\         / \\         / \\
    |   |       |   |       |   |
     \\ /         \\ /         \\ /

           / \\         / \\
          |   |       |   |
           \\ /         \\ /
     
     / \\         / \\         / \\
    |   |       |   |       |   |
     \\ /         \\ /         \\ /
"""

# Variant 3: Large, user-style, perfectly tessellated (Shared edges)
# This is tricky in ASCII.
# Top:    / \
#        /   \
# Mid:  |     |
# Bot:   \   /
#         \ /

# When tiling horizontally:
#    / \     / \
#   /   \   /   \
#  |     | |     |
#   \   /   \   /
#    \ /     \ /
#
# When tiling vertically (staggered):
# To share edges, the bottom "V" of the top row must nest into the top "Λ" of the bottom row.
# But they are side-by-side.
#
#    / \ / \
#   |   |   |  <-- "walls" shared? No, that's squares.
#    \ / \ /
#
# Let's try the larger spaced version the user might like:
grid_large_spaced = """
      / \             / \
     /   \           /   \ 
    |     |         |     |
     \   /           \   /
      \ /             \ /

             / \ 
            /   \ 
           |     |
            \   /
             \ /

      / \             / \
     /   \           /   \ 
    |     |         |     |
     \   /           \   /
      \ /             \ /
"""

print_grid("Compact (Tessellated)", grid_compact)
print_grid("Pointy (Spaced)", grid_spaced)
print_grid("Large (Spaced)", grid_large_spaced)
