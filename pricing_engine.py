"""
ReSell Core Valuation & BOM Decomposition Engine
Author: Jeevan Astha (Founder & CTO, ReSell)
Target: Eureka Junior 2026, IIT Bombay
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

    PLATFORM_MARGIN = 0.18
    ANNUAL_DECAY_RATE = 0.24

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
        base_residual_pool = device.original_msrp_inr * math.exp(-cls.ANNUAL_DECAY_RATE * t_years)
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
