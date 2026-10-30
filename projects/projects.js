import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import { fetchJSON, renderProjects } from '../global.js';

const projects = await fetchJSON('../lib/projects.json');
const projectsContainer = document.querySelector('.projects');

// Count shown in the page heading updates whenever the JSON changes
const projectsTitle = document.querySelector('.projects-title');
if (projectsTitle) {
  projectsTitle.textContent = `${projects?.length ?? 0} Projects`;
}

// ---------- Filters ----------

// Both filters are kept here so the search and the pie can be combined.
// Storing the selected year (not a wedge index) keeps the selection right
// when the search changes which wedges exist.
let query = '';
let selectedYear = null;

function searchProjects() {
  return projects.filter((project) => {
    let values = Object.values(project).join('\n').toLowerCase();
    return values.includes(query.toLowerCase());
  });
}

function getVisibleProjects() {
  let searchedProjects = searchProjects();
  if (selectedYear === null) {
    return searchedProjects;
  }
  return searchedProjects.filter((project) => project.year === selectedYear);
}

// ---------- Pie chart of projects per year ----------

let arcGenerator = d3.arc().innerRadius(0).outerRadius(50);
let sliceGenerator = d3.pie().value((d) => d.value);
// Colour by year rather than position, so a year keeps its colour
// when the search hides other years
let colors = d3.scaleOrdinal(d3.schemeTableau10);

let svg = d3.select('#projects-pie-plot');
let legend = d3.select('.legend');

function renderPieChart(projectsGiven) {
  let rolledData = d3.rollups(
    projectsGiven,
    (v) => v.length,
    (d) => d.year,
  );
  let data = rolledData.map(([year, count]) => {
    return { value: count, label: year };
  });
  let arcData = sliceGenerator(data);
  let arcs = arcData.map((d) => arcGenerator(d));

  // Clear the previous chart before drawing the new one
  svg.selectAll('path').remove();
  legend.selectAll('li').remove();

  arcs.forEach((arc, i) => {
    svg
      .append('path')
      .attr('d', arc)
      .attr('fill', colors(data[i].label))
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', `${data[i].label}: ${data[i].value} projects`)
      .on('click', () => toggleYear(i))
      .on('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleYear(i);
        }
      });
  });

  data.forEach((d, i) => {
    legend
      .append('li')
      .attr('class', 'legend-item')
      .attr('style', `--color:${colors(d.label)}`)
      .html(`<span class="swatch"></span> ${d.label} <em>(${d.value})</em>`)
      .on('click', () => toggleYear(i));
  });

  function toggleYear(i) {
    selectedYear = selectedYear === data[i].label ? null : data[i].label;
    highlightSelectedYear();
    renderProjects(getVisibleProjects(), projectsContainer, 'h2');
  }

  function highlightSelectedYear() {
    svg
      .selectAll('path')
      .classed('selected', (_, idx) => data[idx].label === selectedYear)
      .attr('aria-pressed', (_, idx) => data[idx].label === selectedYear);
    legend
      .selectAll('li')
      .classed('selected', (_, idx) => data[idx].label === selectedYear);
  }

  highlightSelectedYear();
}

// ---------- Search ----------

let searchInput = document.querySelector('.searchBar');

searchInput.addEventListener('input', (event) => {
  query = event.target.value;
  let searchedProjects = searchProjects();

  // If the search hid every project from the selected year, its wedge is
  // gone too, so drop the selection instead of filtering by an invisible year
  if (!searchedProjects.some((project) => project.year === selectedYear)) {
    selectedYear = null;
  }

  // The pie counts every search result, so the other years stay clickable
  renderPieChart(searchedProjects);
  renderProjects(getVisibleProjects(), projectsContainer, 'h2');
});

// First render on page load
renderPieChart(projects);
renderProjects(projects, projectsContainer, 'h2');
