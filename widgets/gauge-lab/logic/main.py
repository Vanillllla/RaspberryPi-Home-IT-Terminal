def advance(ctx):
    try:
        value = (ctx.get("dial", "value") + 10) % 101
        ctx.set("dial", "value", value, persist=True)
        ctx.set("dial", "color", "#b24631" if value > 70 else "#157552")
    except KeyError:
        value = 0
    ctx.set("percent", "text", f"{value} %", persist=True)
