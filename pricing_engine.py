"""
ReSell Core Valuation & BOM Decomposition Engine
Author: Jeevan Astha (Founder & CTO, ReSell)
Target: Eureka Junior 2026, IIT Bombay

────────────────────────────────────────────────────────────────────────────
RELATIONSHIP TO THE WEB PROTOTYPE
────────────────────────────────────────────────────────────────────────────
This module is the *reference* / server-side valuation engine. It is NOT
loaded by index.html — the browser prototype ships a simplified version of
this same model inline in app.js (`BOM_BASE`, `COND_MULT`, `runDisassembly`)
so the demo runs with no backend.

What the two implementations agree on:
  • The same five salvageable components (logic board, display, camera,
    battery, chassis).
  • The same 18% platform-and-warranty reserve — `PLATFORM_MARGIN` here,
    the `gross * 0.82` in app.js `runDisassembly()`.
  • Value decays with device age and is scaled by condition.

Where they deliberately differ (do not "fix" one to match the other without
a product decision):
  • Decay — app.js uses a per-brand *monthly* geometric decay
    (`BOM_BASE[brand].decay`, ~2.0–2.6%/month). This module uses a single
    continuous *annual* rate (`ANNUAL_DECAY_RATE = 0.24`).
  • Component value — app.js starts from a flat per-brand rupee table
    (`BOM_BASE`). This module derives it from original MSRP × `BOM_WEIGHTS`.
  • Grading — app.js exposes one whole-device condition (the #sel-cond
    dropdown, 4 options). This module grades each component separately and
    reads battery *health percentage* rather than a grade. See
    `UI_CONDITION_MAP` / `DeviceInput.from_ui_selection()` below, which
    bridge the browser's 4-option dropdown onto this richer model.
  • Market momentum — `days_to_next_oem_launch` has no counterpart in the
    prototype UI yet.

Front-end contract, for whoever wires this up as a real API:
  brand keys ....... realme apple samsung google oneplus xiaomi oppo vivo
                     motorola nothing nokia      (index.html #sel-brand)
  condition keys ... flawless good cracked dead  (index.html #sel-cond)
  age .............. derived from #sel-buy-year + #sel-buy-month
  response ......... `compute_valuation()` returns the same five BOM line
                     items app.js paints into #bom-rows, plus the net figure
                     that lands in #bom-total.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Dict, Any
import math
import json


class ConditionGrade(Enum):
    PRISTINE = "pristine"       # Grade A: Like-new OEM
    GOOD = "good"               # Grade B: Minor wear, 100% functional
    FAIR = "fair"               # Grade C: Functional with cosmetic defect
    DEFECTIVE = "defective"     # Grade D: Requires component-level IC/glass repair
    DEAD = "dead"               # E-Waste: Smelting/Precious metal recovery only


@dataclass
class DeviceInput:
    model_name: str
    original_msrp_inr: float
    age_months: int
    display_condition: ConditionGrade
    battery_health_pct: int
    camera_condition: ConditionGrade
    logic_board_condition: ConditionGrade
    chassis_condition: ConditionGrade
    days_to_next_oem_launch: int = 45

    @classmethod
    def from_ui_selection(cls, model_name, original_msrp_inr, buy_year, buy_month,
                          ui_condition, now_year=2026, now_month=8, **kw):
        """Build a DeviceInput from exactly what index.html's sell form collects.

        Mirrors the age arithmetic in app.js `runDisassembly()`:
        #sel-buy-year / #sel-buy-month against a fixed "now", floored at 1
        month. `ui_condition` is a raw #sel-cond value: flawless | good |
        cracked | dead.
        """
        grades = ReSellPricingEngine.UI_CONDITION_MAP.get(
            ui_condition, ReSellPricingEngine.UI_CONDITION_MAP["cracked"])
        age_months = max(1, (now_year - buy_year) * 12 + (now_month - buy_month))
        return cls(
            model_name=model_name,
            original_msrp_inr=original_msrp_inr,
            age_months=age_months,
            display_condition=grades["display"],
            battery_health_pct=grades["battery_pct"],
            camera_condition=grades["camera"],
            logic_board_condition=grades["logic"],
            chassis_condition=grades["chassis"],
            **kw,
        )


class ReSellPricingEngine:
    BOM_WEIGHTS = {
        "logic_board": 0.38,
        "display_panel": 0.28,
        "camera_module": 0.18,
        "battery_cell": 0.08,
        "chassis_frame": 0.08
    }

    GRADE_MULTIPLIERS = {
        ConditionGrade.PRISTINE: 1.00,
        ConditionGrade.GOOD: 0.85,
        ConditionGrade.FAIR: 0.65,
        ConditionGrade.DEFECTIVE: 0.30,
        ConditionGrade.DEAD: 0.05,
    }

    # ── Bridge from the browser's single 4-option #sel-cond dropdown ──
    # app.js COND_MULT is { flawless:1.0, good:0.85, cracked:0.60, dead:0.25 }.
    # Mapped here to per-component grades: a cracked screen is a display/
    # chassis problem, not a logic-board one, which is the whole point of
    # component-level triage.
    UI_CONDITION_MAP = {
        "flawless": {
            "display": ConditionGrade.PRISTINE, "camera": ConditionGrade.PRISTINE,
            "logic": ConditionGrade.PRISTINE, "chassis": ConditionGrade.PRISTINE,
            "battery_pct": 95,
        },
        "good": {
            "display": ConditionGrade.GOOD, "camera": ConditionGrade.GOOD,
            "logic": ConditionGrade.PRISTINE, "chassis": ConditionGrade.GOOD,
            "battery_pct": 87,
        },
        "cracked": {
            "display": ConditionGrade.DEFECTIVE, "camera": ConditionGrade.GOOD,
            "logic": ConditionGrade.GOOD, "chassis": ConditionGrade.FAIR,
            "battery_pct": 82,
        },
        "dead": {
            "display": ConditionGrade.DEAD, "camera": ConditionGrade.DEFECTIVE,
            "logic": ConditionGrade.DEAD, "chassis": ConditionGrade.FAIR,
            "battery_pct": 60,
        },
    }

    PLATFORM_MARGIN = 0.18
    ANNUAL_DECAY_RATE = 0.24
    # Stricter pricing policy: depresses/depletes component valuations by an additional 30%
    STRICT_DEPLETION_FACTOR = 0.70

    @classmethod
    def calculate_market_momentum_factor(cls, days_to_launch: int) -> float:
        if days_to_launch > 60:
            return 1.00
        elif days_to_launch <= 0:
            return 0.82
        else:
            sigmoid = 1 / (1 + math.exp(-(days_to_launch - 25) / 8))
            return round(0.82 + 0.18 * sigmoid, 4)

    @classmethod
    def compute_battery_multiplier(cls, health_pct: int) -> float:
        if health_pct >= 90:
            return 1.00
        elif health_pct >= 80:
            return round(0.60 + (health_pct - 80) * 0.04, 2)
        elif health_pct >= 70:
            return 0.35
        else:
            return 0.08

    @classmethod
    def compute_valuation(cls, device: DeviceInput) -> Dict[str, Any]:
        t_years = max(0.1, device.age_months / 12.0)
        base_residual_pool = device.original_msrp_inr * math.exp(-cls.ANNUAL_DECAY_RATE * t_years) * cls.STRICT_DEPLETION_FACTOR
        momentum_idx = cls.calculate_market_momentum_factor(device.days_to_next_oem_launch)

        bom_payouts = {}
        
        display_raw = base_residual_pool * cls.BOM_WEIGHTS["display_panel"] * cls.GRADE_MULTIPLIERS[device.display_condition]
        bom_payouts["display_panel"] = round(display_raw * momentum_idx, 2)

        logic_raw = base_residual_pool * cls.BOM_WEIGHTS["logic_board"] * cls.GRADE_MULTIPLIERS[device.logic_board_condition]
        bom_payouts["logic_board"] = round(logic_raw * momentum_idx, 2)

        camera_raw = base_residual_pool * cls.BOM_WEIGHTS["camera_module"] * cls.GRADE_MULTIPLIERS[device.camera_condition]
        bom_payouts["camera_module"] = round(camera_raw * momentum_idx, 2)

        battery_mult = cls.compute_battery_multiplier(device.battery_health_pct)
        battery_raw = base_residual_pool * cls.BOM_WEIGHTS["battery_cell"] * battery_mult
        bom_payouts["battery_cell"] = round(battery_raw * momentum_idx, 2)

        chassis_raw = base_residual_pool * cls.BOM_WEIGHTS["chassis_frame"] * cls.GRADE_MULTIPLIERS[device.chassis_condition]
        bom_payouts["chassis_frame"] = round(chassis_raw * momentum_idx, 2)

        gross_salvage_value = sum(bom_payouts.values())
        platform_fee = round(gross_salvage_value * cls.PLATFORM_MARGIN, 2)
        net_customer_payout = round(gross_salvage_value - platform_fee, 2)

        is_refurbishable = (
            device.logic_board_condition in [ConditionGrade.PRISTINE, ConditionGrade.GOOD]
            and device.display_condition in [ConditionGrade.PRISTINE, ConditionGrade.GOOD, ConditionGrade.FAIR]
        )

        return {
            "device": device.model_name,
            "original_msrp_inr": device.original_msrp_inr,
            "age_months": device.age_months,
            "market_momentum_index": momentum_idx,
            "triage_recommendation": "PREMIUM_REFURBISH_1YR_WARRANTY" if is_refurbishable else "HARVEST_OEM_COMPONENTS",
            "component_bom_payouts_inr": bom_payouts,
            "gross_salvage_value_inr": round(gross_salvage_value, 2),
            "platform_and_warranty_reserve_inr": platform_fee,
            "net_seller_payout_inr": net_customer_payout,
            "bom_percentage_breakdown": {
                k: f"{(v / gross_salvage_value * 100):.1f}%" for k, v in bom_payouts.items()
            }
        }


if __name__ == "__main__":
    sample_phone = DeviceInput(
        model_name="iPhone 13 (128GB)",
        original_msrp_inr=69900.0,
        age_months=28,
        display_condition=ConditionGrade.GOOD,
        battery_health_pct=83,
        camera_condition=ConditionGrade.PRISTINE,
        logic_board_condition=ConditionGrade.PRISTINE,
        chassis_condition=ConditionGrade.FAIR,
        days_to_next_oem_launch=20
    )

    result = ReSellPricingEngine.compute_valuation(sample_phone)
    print("=" * 60)
    print("ReSell Pricing Engine v1.0 — Test Valuation Output")
    print("=" * 60)
    print(json.dumps(result, indent=2))
