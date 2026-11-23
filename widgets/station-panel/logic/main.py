def rename(ctx):
    name = ctx.get("nameInput", "value").strip() or "Station"
    ctx.set_setting("stationName", name)
    ctx.emit("settingsChanged")


def show_name(ctx):
    name = ctx.setting("stationName")
    for element in ("station", "detailName"):
        ctx.set(element, "text", name, persist=True)
    ctx.set("nameInput", "value", name, persist=True)


def check(ctx):
    ctx.set("detailName", "text", ctx.setting("stationName"))
    for element in ("detailStatus", "reading"):
        ctx.set(element, "text", "Checked", persist=True)
