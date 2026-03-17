from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import requests
import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_squared_error, mean_absolute_error
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import pandas as pd

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/disease-sh/global")
def get_global():
    return requests.get("https://disease.sh/v3/covid-19/all").json()

@app.get("/disease-sh/countries")
def get_countries():
    return requests.get("https://disease.sh/v3/covid-19/countries?sort=cases").json()

@app.get("/disease-sh/country/{name}")
def get_one_country(name: str):
    r = requests.get(f"https://disease.sh/v3/covid-19/countries/{name}")
    if r.status_code == 200:
        return r.json()
    return {"error": "Country not found"}

@app.get("/disease-sh/history/{country}")
def get_history(country: str, days: int = 30):
    r = requests.get(f"https://disease.sh/v3/covid-19/historical/{country}?lastdays={days}")
    if r.status_code == 200:
        return r.json()
    return {"error": "Not found"}

@app.get("/who/indicator/{code}")
def get_who_indicator(code: str, country: str = None):
    base = f"https://ghoapi.azureedge.net/api/{code}"
    url = f"{base}?$filter=SpatialDim eq '{country}'" if country else f"{base}?$orderby=TimeDim desc&$top=200"
    r = requests.get(url)
    if r.status_code == 200:
        records = []
        for item in r.json().get("value", []):
            records.append({
                "country": item.get("SpatialDim"),
                "year": item.get("TimeDim"),
                "value": item.get("NumericValue")
            })
        return {"indicator": code, "data": records, "total": len(records)}
    return {"error": "WHO data unavailable"}

@app.get("/promed/alerts")
def get_promed_alerts(count: int = 10):
    promed_rss = "https://promedmail.org/feed/"
    proxy_url = f"https://api.rss2json.com/v1/api.json?rss_url={promed_rss}&count={count}"
    r = requests.get(proxy_url, timeout=10)
    if r.status_code != 200:
        return {"error": "Could not fetch alerts"}
    alerts = []
    for item in r.json().get("items", []):
        alerts.append({
            "title": item.get("title", ""),
            "link": item.get("link", ""),
            "published": item.get("pubDate", ""),
            "summary": item.get("description", "")[:300]
        })
    return {"source": "ProMED Mail", "alerts": alerts, "count": len(alerts)}

@app.get("/ecdc/covid")
def get_ecdc_covid():
    url = "https://opendata.ecdc.europa.eu/covid19/nationalcasedeath_eueea_daily_ei/json/"
    r = requests.get(url, timeout=15)
    if r.status_code != 200:
        return {"error": "ECDC data unavailable"}
    records = r.json().get("records", [])
    latest = {}
    for record in records:
        country = record.get("countriesAndTerritories", "")
        if country not in latest:
            latest[country] = {
                "country": country,
                "cases": record.get("cases", 0),
                "deaths": record.get("deaths", 0)
            }
    return {"source": "ECDC", "countries": list(latest.values()), "total_countries": len(latest)}

@app.get("/anomalies")
def detect_anomalies():
    response = requests.get("https://disease.sh/v3/covid-19/countries")
    countries = response.json()
    records = []
    for c in countries:
        records.append({
            "country": c["country"],
            "cases": c.get("cases", 0),
            "deaths": c.get("deaths", 0),
            "active": c.get("active", 0),
            "casesPerMillion": c.get("casesPerOneMillion", 0),
            "deathsPerMillion": c.get("deathsPerOneMillion", 0),
            "todayCases": c.get("todayCases", 0),
            "todayDeaths": c.get("todayDeaths", 0),
            "lat": c["countryInfo"].get("lat", 0),
            "lng": c["countryInfo"].get("long", 0),
        })
    df = pd.DataFrame(records)
    features = ["casesPerMillion", "deathsPerMillion", "todayCases", "todayDeaths"]
    X = df[features].fillna(0)
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    model = IsolationForest(contamination=0.08, random_state=42)
    df["anomaly"] = model.fit_predict(X_scaled)
    df["score"] = model.decision_function(X_scaled)
    anomalies = df[df["anomaly"] == -1].sort_values("score")
    result = []
    for _, row in anomalies.iterrows():
        result.append({
            "country": row["country"],
            "todayCases": int(row["todayCases"]),
            "todayDeaths": int(row["todayDeaths"]),
            "casesPerMillion": float(row["casesPerMillion"]),
            "anomalyScore": round(float(row["score"]), 3),
            "lat": row["lat"],
            "lng": row["lng"]
        })
    return {"anomalies": result, "total_found": len(result)}

@app.get("/insights/{country}")
def get_insights(country: str):
    r = requests.get(f"https://disease.sh/v3/covid-19/historical/{country}?lastdays=30")
    if r.status_code != 200:
        return {"error": "Country not found"}
    data = r.json()
    timeline = data.get("timeline", {}).get("cases", {})
    if not timeline:
        return {"error": "No data"}
    dates = list(timeline.keys())
    cases = list(timeline.values())
    cases_array = np.array(cases)
    X = np.array(range(len(cases))).reshape(-1, 1)
    model = LinearRegression()
    model.fit(X, cases_array)
    predicted = model.predict(X)
    rmse = float(np.sqrt(mean_squared_error(cases_array, predicted)))
    mae = float(mean_absolute_error(cases_array, predicted))
    r2 = float(model.score(X, cases_array))
    last_7 = cases[-1] - cases[-7]
    last_14 = cases[-1] - cases[-14]
    pct_7 = round((last_7 / cases[-7]) * 100, 1) if cases[-7] else 0
    pct_14 = round((last_14 / cases[-14]) * 100, 1) if cases[-14] else 0
    future_X = np.array(range(len(cases), len(cases) + 7)).reshape(-1, 1)
    forecast = model.predict(future_X)
    forecast_pct = round(((forecast[-1] - cases[-1]) / cases[-1]) * 100, 1) if cases[-1] else 0
    daily_new = [cases[i] - cases[i-1] for i in range(1, len(cases))]
    avg_daily = round(sum(daily_new) / len(daily_new), 0)
    peak_day = dates[daily_new.index(max(daily_new)) + 1]
    peak_cases = max(daily_new)
    return {
        "country": country,
        "latest_cases": cases[-1],
        "trend": {
            "7_day_change_pct": pct_7,
            "14_day_change_pct": pct_14,
            "direction": "increasing" if pct_7 > 0 else "decreasing",
            "avg_daily_new": avg_daily,
            "peak_day": peak_day,
            "peak_new_cases": peak_cases,
        },
        "forecast": {
            "7_day_forecast_cases": int(forecast[-1]),
            "expected_change_pct": forecast_pct,
            "daily_growth_rate": round(float(model.coef_[0]), 0),
        },
        "model_metrics": {
            "rmse": round(rmse, 2),
            "mae": round(mae, 2),
            "r2_score": round(r2, 4),
            "r2_percent": round(r2 * 100, 1),
            "interpretation": "Excellent" if r2 > 0.95 else "Good" if r2 > 0.80 else "Moderate"
        }
    }

@app.get("/unified/dashboard")
def unified_dashboard():
    result = {}
    try:
        result["disease_sh_global"] = requests.get("https://disease.sh/v3/covid-19/all", timeout=8).json()
    except:
        result["disease_sh_global"] = {"error": "unavailable"}
    try:
        who = requests.get("https://ghoapi.azureedge.net/api/WHOSIS_000001?$filter=SpatialDim eq 'IND'&$orderby=TimeDim desc&$top=1", timeout=8).json()
        d = who.get("value", [{}])[0]
        result["who_india"] = {"indicator": "Life expectancy", "country": "India", "year": d.get("TimeDim"), "value": d.get("NumericValue")}
    except:
        result["who_india"] = {"error": "unavailable"}
    try:
        rss = requests.get("https://api.rss2json.com/v1/api.json?rss_url=https://promedmail.org/feed/&count=5", timeout=8).json()
        result["promed_alerts"] = [{"title": i["title"], "date": i["pubDate"], "link": i["link"]} for i in rss.get("items", [])]
    except:
        result["promed_alerts"] = []
    try:
        ecdc = requests.get("https://opendata.ecdc.europa.eu/covid19/nationalcasedeath_eueea_daily_ei/json/", timeout=10).json()
        countries = list(set(r.get("countriesAndTerritories") for r in ecdc.get("records", [])))
        result["ecdc_summary"] = {"region": "EU/EEA", "countries_reporting": len(countries)}
    except:
        result["ecdc_summary"] = {"error": "unavailable"}
    return result

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)