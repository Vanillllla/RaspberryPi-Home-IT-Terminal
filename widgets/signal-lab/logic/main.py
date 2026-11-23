def apply_signal(ctx):
    power = ctx.get("power", "value")
    level = ctx.get("level", "value")
    color = "#157552" if power else "#aa3842"
    ctx.set("lamp", "color", color)
    ctx.set("lamp", "label", "On" if power else "Off")
    ctx.set("result", "color", color)
    ctx.set("result", "text", f"{level} %", persist=True)
