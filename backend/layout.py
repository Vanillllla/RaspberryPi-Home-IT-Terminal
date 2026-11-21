COLUMNS = 12
DEFAULT_WIDTH = 4
DEFAULT_HEIGHT = 2
# Enough rows for all 4096 legacy slots in a three-column landscape layout.
MAX_ROWS = 2732


def row_count(widgets):
    bottom = max((w["slot"] // COLUMNS + w["height"] for w in widgets), default=0)
    return max(6, bottom)


class Layout:
    def __init__(self, conn, desktop_id, exclude=None, *, rows=None):
        widgets = conn.execute("SELECT id, slot, width, height FROM widgets WHERE desktop_id=?",
                               (desktop_id,)).fetchall()
        self.rows = rows if rows is not None else row_count(widgets)
        self.occupied = [0] * self.rows
        for w in widgets:
            if w["id"] == exclude:
                continue
            y, x = divmod(w["slot"], COLUMNS)
            mask = ((1 << w["width"]) - 1) << x
            for row in range(y, min(self.rows, y + w["height"])):
                self.occupied[row] |= mask

    def conflict(self, slot, width, height):
        y, x = divmod(slot, COLUMNS)
        if x + width > COLUMNS or y + height > self.rows:
            return "Прямоугольник выходит за границы сетки"
        mask = ((1 << width) - 1) << x
        if any(row & mask for row in self.occupied[y:y + height]):
            return "Часть прямоугольника занята другим виджетом"
        return None
