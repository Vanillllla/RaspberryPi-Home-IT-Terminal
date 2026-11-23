from math import sin
from time import time


def measure(ctx):
    value = round(50 + 30 * sin(time() / 12), 1)
    ctx.sample("signal", value)
    ctx.set("current", "text", f"{value:.1f}", persist=True)
    ctx.set("plot", "points", ctx.history("signal", 240), persist=True)
