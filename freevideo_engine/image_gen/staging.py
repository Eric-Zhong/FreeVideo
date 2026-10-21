"""Pure coordinate-to-prompt mapping for first frames; no files or model calls.

Keep this policy separate from compose's reference loading so later staging
experiments can replace it without changing the Agent request/result contract.
People are validated by compose before reaching this function.
"""


def scene_prompt(people):
    """The measured pos2 wording, with scene first and integer percentages.

    Equal feet and unequal full-body heights express the two-person depth cue
    from pos2 shot 8. Reference order never changes to describe that depth.
    Explicit framing/facing extensions follow the complete baseline prompt.
    """
    labels = [person.get('name', '').strip() or f'person {i}'
              for i, person in enumerate(people, 1)]
    sentences = [
        'Image 1 is an empty scene; the background of the result must be exactly this scene '
        '(its walls, floor, windows and lighting), not the plain backdrop of the character photos.']
    sentences.extend(f'Image {i} is the character {name}.' for i, name in enumerate(labels, 2))
    positions = [f'{name} centred at {person["x"] * 100:.0f} percent of the image width, '
                 f'full body, about {person["height"] * 100:.0f} percent of the image height'
                 for name, person in zip(labels, people)]
    feet = [f'{person["feet"] * 100:.0f}' for person in people]
    if len(set(feet)) == 1:
        positions.append(f'all feet at about {feet[0]} percent of the image height, whole body from head to shoes')
    else:
        positions.extend(f'{name} feet at about {foot} percent of the image height, whole body from head to shoes'
                         for name, foot in zip(labels, feet))
    sentences.append('Place the characters in the scene: ' + '; '.join(positions) + '.')
    heights = [round(person['height'] * 100) for person in people]
    if len(people) == 2 and len(set(feet)) == 1 and heights[0] != heights[1] \
            and all(person.get('framing', 'full') == 'full' for person in people):
        near, far = (0, 1) if heights[0] > heights[1] else (1, 0)
        sentences.append(f'{labels[near]} is closer to the camera and larger, '
                         f'{labels[far]} is farther away and smaller.')
    sentences.append("Keep each face and the clothes as in the character's own image and match the lighting of the scene.")
    for index, person in enumerate(people, 2):
        if 'facing' in person or person.get('framing', 'full') != 'full':
            sentences.append(position_prompt([person], first_image=index))
    return ' '.join(sentences)


def position_prompt(people, *, first_image=2):
    """Describe positions in screen coordinates, preserving input/reference order.

    Height means the visible figure's fraction of frame height. For a half-body
    shot this is the head-to-waist figure, rather than an off-screen full body.
    """
    sentences = []
    for index, person in enumerate(people, first_image):
        x, height = person['x'], person['height']
        side = 'on the screen left' if x < .5 else 'on the screen right' if x > .5 else 'in the screen centre'
        full = person.get('framing', 'full') == 'full'
        figure = 'full-body' if full else 'visible upper-body'
        sentences.append(
            f'The person in image {index} stands {side}, centred at x={x:g} '
            f'({x * 100:g}% of frame width from the left edge), with {figure} height '
            f'{height:g} ({height * 100:g}% of frame height), facing screen {person.get("facing", "right")}. '
            + ('Show their full body from head to shoes, with both shoes inside the frame.' if full else
               'Show them from head to waist, a half-body view.'))
        if 'feet' in person:
            sentences.append(f'The bottom of this visible figure is at {person["feet"] * 100:g}% of frame height from the top.')
    return ' '.join(sentences)
