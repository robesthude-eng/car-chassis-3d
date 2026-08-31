export function createBoot() {
  const bootScreen = document.getElementById("boot-screen");
  const bootFill = document.getElementById("boot-fill");
  const bootStepEl = document.getElementById("boot-step");
  const bootRetry = document.getElementById("boot-retry");

  function bootProgress(pct, label) {
    if (bootFill) bootFill.style.width = Math.max(3, Math.min(100, pct)) + "%";
    if (bootStepEl && label) bootStepEl.textContent = label;
  }

  function bootDone() {
    if (!bootScreen || bootScreen.classList.contains("done")) return;
    bootProgress(100, "Готово");
    bootScreen.setAttribute("aria-busy", "false");
    bootScreen.classList.add("done");
    setTimeout(function () {
      bootScreen.style.display = "none";
    }, 520);
  }

  function bootFail(err) {
    if (bootStepEl)
      bootStepEl.textContent =
        "Ошибка сборки: " + ((err && err.message) || err);
    if (bootScreen) {
      bootScreen.setAttribute("role", "alert");
      bootScreen.setAttribute("aria-busy", "false");
    }
    if (bootRetry) {
      bootRetry.hidden = false;
      bootRetry.addEventListener("click", () => window.location.reload(), {
        once: true,
      });
    }
    console.error(err);
  }

  return {
    bootScreen,
    bootFill,
    bootStepEl,
    bootRetry,
    bootProgress,
    bootDone,
    bootFail,
  };
}
