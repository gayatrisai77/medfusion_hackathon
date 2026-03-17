const BACKEND = 'http://localhost:8000';

const map = L.map('map').setView([20, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: 'OpenStreetMap contributors'
}).addTo(map);

async function loadGlobalStats() {
  try {
    const response = await fetch(`${BACKEND}/disease-sh/global`);
    const data = await response.json();
    document.getElementById('totalCases').textContent = data.cases.toLocaleString();
    document.getElementById('totalDeaths').textContent = data.deaths.toLocaleString();
    document.getElementById('totalRecovered').textContent = data.recovered.toLocaleString();
    document.getElementById('totalCountries').textContent = data.affectedCountries;
  } catch(e) {
    console.log('Stats error:', e);
  }
}

async function loadMapData() {
  try {
    const response = await fetch(`${BACKEND}/disease-sh/countries`);
    const countries = await response.json();
    countries.forEach(country => {
      const lat = country.countryInfo.lat;
      const lng = country.countryInfo.long;
      if (!lat || !lng) return;
      L.circle([lat, lng], {
        radius: Math.sqrt(country.cases) * 80,
        color: '#e53e3e',
        fillColor: '#e53e3e',
        fillOpacity: 0.35,
        weight: 1
      })
      .bindPopup(`
        <b>${country.country}</b><br>
        Cases: ${country.cases.toLocaleString()}<br>
        Deaths: ${country.deaths.toLocaleString()}<br>
        Recovered: ${country.recovered.toLocaleString()}
      `)
      .addTo(map);
    });
  } catch(e) {
    console.log('Map error:', e);
  }
}

async function loadBarChart() {
  try {
    const response = await fetch(`${BACKEND}/disease-sh/countries`);
    const countries = await response.json();
    const top10 = countries.slice(0, 10);
    const ctx = document.getElementById('barChart').getContext('2d');
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: top10.map(c => c.country),
        datasets: [
          {
            label: 'Total Cases',
            data: top10.map(c => c.cases),
            backgroundColor: 'rgba(229, 62, 62, 0.6)',
            borderColor: '#e53e3e',
            borderWidth: 1
          },
          {
            label: 'Total Deaths',
            data: top10.map(c => c.deaths),
            backgroundColor: 'rgba(221, 107, 32, 0.6)',
            borderColor: '#dd6b20',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#e6edf3' } } },
        scales: {
          x: { ticks: { color: '#8b949e' }, grid: { color: '#30363d' } },
          y: { ticks: { color: '#8b949e' }, grid: { color: '#30363d' } }
        }
      }
    });
  } catch(e) {
    console.log('Chart error:', e);
  }
}

async function loadAlerts() {
  const alertFeed = document.getElementById('alertFeed');
  try {
    const response = await fetch(`${BACKEND}/promed/alerts?count=8`);
    const data = await response.json();
    if (!data.alerts || data.alerts.length === 0) {
      alertFeed.innerHTML = '<p>No alerts right now.</p>';
      return;
    }
    alertFeed.innerHTML = '';
    data.alerts.forEach(alert => {
      const date = new Date(alert.published).toLocaleDateString();
      alertFeed.innerHTML += `
        <div class="alert-item">
          <a href="${alert.link}" target="_blank">${alert.title}</a>
          <div class="date">${date}</div>
        </div>
      `;
    });
  } catch(e) {
    alertFeed.innerHTML = '<p>Could not load alerts.</p>';
  }
}

async function loadAnomalies() {
  const anomalyList = document.getElementById('anomalyList');
  try {
    const response = await fetch(`${BACKEND}/anomalies`);
    const data = await response.json();

    data.anomalies.forEach(a => {
      if (!a.lat || !a.lng) return;
      L.circleMarker([a.lat, a.lng], {
        radius: 12,
        color: '#f6e05e',
        fillColor: '#f6e05e',
        fillOpacity: 0.9,
        weight: 2
      })
      .bindPopup(`
        <b>ANOMALY DETECTED</b><br>
        <b>${a.country}</b><br>
        Today Cases: ${a.todayCases.toLocaleString()}<br>
        Today Deaths: ${a.todayDeaths.toLocaleString()}<br>
        <i>ML flagged as unusual activity</i>
      `)
      .addTo(map);
    });

    anomalyList.innerHTML = `<p style="color:#8b949e; margin-bottom:12px">AI detected ${data.total_found} countries with unusual patterns</p>`;
    data.anomalies.slice(0, 6).forEach(a => {
      anomalyList.innerHTML += `
        <div class="anomaly-item">
          <b>${a.country}</b> — ${a.todayCases.toLocaleString()} new cases today
          <div class="date">Anomaly score: ${a.anomalyScore}</div>
        </div>
      `;
    });
  } catch(e) {
    anomalyList.innerHTML = '<p>Could not load anomaly data.</p>';
  }
}

async function loadInsights(country) {
  const section = document.getElementById('insightsSection');
  section.style.display = 'block';
  try {
    const response = await fetch(`${BACKEND}/insights/${country}`);
    const data = await response.json();
    if (data.error) return;

    const trend    = data.trend;
    const forecast = data.forecast;
    const metrics  = data.model_metrics;

    const t7 = trend['7_day_change_pct'];
    document.getElementById('trend7').textContent = `${t7 > 0 ? '+' : ''}${t7}%`;
    document.getElementById('trend7').className = `insight-value ${t7 > 0 ? 'positive' : 'negative'}`;
    document.getElementById('trendDirection').textContent = trend.direction;

    const t14 = trend['14_day_change_pct'];
    document.getElementById('trend14').textContent = `${t14 > 0 ? '+' : ''}${t14}%`;
    document.getElementById('trend14').className = `insight-value ${t14 > 0 ? 'positive' : 'negative'}`;

    document.getElementById('avgDaily').textContent = Number(trend.avg_daily_new).toLocaleString();

    const fp = forecast.expected_change_pct;
    document.getElementById('forecastChange').textContent = `${fp > 0 ? '+' : ''}${fp}%`;
    document.getElementById('forecastChange').className = `insight-value ${fp > 0 ? 'positive' : 'negative'}`;
    document.getElementById('forecastCases').textContent = `${forecast['7_day_forecast_cases'].toLocaleString()} projected cases`;

    document.getElementById('rmse').textContent = Number(metrics.rmse).toLocaleString();
    document.getElementById('mae').textContent = Number(metrics.mae).toLocaleString();
    document.getElementById('r2').textContent = `${metrics.r2_percent}%`;
    document.getElementById('r2Label').textContent = `${metrics.r2_percent}% variance explained`;
    document.getElementById('modelQuality').textContent = metrics.interpretation;

    const qualityColor =
      metrics.interpretation === 'Excellent' ? '#68d391' :
      metrics.interpretation === 'Good'      ? '#f6ad55' : '#fc8181';
    document.getElementById('modelQuality').style.color = qualityColor;

  } catch(e) {
    console.log('Insights error:', e);
  }
}

async function loadForecast(country) {
  const section = document.getElementById('forecastSection');
  section.style.display = 'block';
  try {
    const response = await fetch(`${BACKEND}/disease-sh/history/${country}?days=30`);
    const data = await response.json();
    const timeline = data.timeline?.cases;
    if (!timeline) return;
    const dates = Object.keys(timeline).slice(-14);
    const cases = Object.values(timeline).slice(-14);
    const ctx = document.getElementById('forecastChart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: dates,
        datasets: [{
          label: `${country} — Historical Cases`,
          data: cases,
          borderColor: '#3182ce',
          backgroundColor: 'rgba(49,130,206,0.1)',
          tension: 0.3,
          fill: true
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#e6edf3' } } },
        scales: {
          x: { ticks: { color: '#8b949e', maxTicksLimit: 7 }, grid: { color: '#30363d' } },
          y: { ticks: { color: '#8b949e' }, grid: { color: '#30363d' } }
        }
      }
    });
  } catch(e) {
    console.log('Forecast error:', e);
  }
}

async function searchCountry() {
  const query = document.getElementById('searchInput').value.trim();
  if (!query) { alert('Please type a country name!'); return; }
  const resultBox = document.getElementById('resultBox');
  resultBox.classList.remove('hidden');
  resultBox.innerHTML = 'Searching...';
  try {
    const response = await fetch(`${BACKEND}/disease-sh/country/${query}`);
    const d = await response.json();
    if (d.error) { resultBox.innerHTML = d.error; return; }
    resultBox.innerHTML = `
      <h3>${d.country} — Disease Data</h3>
      <div style="display:flex; gap:20px; flex-wrap:wrap; margin-top:15px;">
        <div>Cases: <b>${d.cases.toLocaleString()}</b></div>
        <div>Deaths: <b>${d.deaths.toLocaleString()}</b></div>
        <div>Recovered: <b>${d.recovered.toLocaleString()}</b></div>
        <div>Active: <b>${d.active.toLocaleString()}</b></div>
        <div>Tests: <b>${d.tests.toLocaleString()}</b></div>
        <div>Population: <b>${d.population.toLocaleString()}</b></div>
      </div>
    `;
    map.setView([d.countryInfo.lat, d.countryInfo.long], 5);
    loadForecast(query);
    loadInsights(query);
  } catch(e) {
    resultBox.innerHTML = 'Something went wrong. Try again.';
  }
}

document.getElementById('searchInput').addEventListener('keypress', function(e) {
  if (e.key === 'Enter') searchCountry();
});

loadGlobalStats();
loadMapData();
loadBarChart();
loadAlerts();
loadAnomalies();